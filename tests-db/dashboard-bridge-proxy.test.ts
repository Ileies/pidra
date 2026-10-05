// The dashboard's side of the skills bridge: the proxy helpers, the +server routes that only
// forward, the SSE relay with its shutdown behaviour, and the form actions that call the bridge.
// The bridge itself is a stubbed `fetch`; nothing here touches a database or a real network.
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";

setPrivateEnv();
const bridge = await import("../dashboard/src/lib/server/bridge");
const shutdown = await import("../dashboard/src/lib/server/shutdown");
const route = async (path: string) => import(`../dashboard/src/routes/${path}/+server`);
const questions = await import("../dashboard/src/routes/questions/+page.server");
const skills = await import("../dashboard/src/routes/skills/+page.server");

interface Sent { url: string; init: RequestInit }
const sent: Sent[] = [];
let upstream: (url: string, init: RequestInit) => Response | Promise<Response> = () => Response.json({ ok: true });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  sent.push({ url: String(input), init });
  return upstream(String(input), init);
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  sent.length = 0;
  upstream = () => Response.json({ ok: true });
});

const down = () => { upstream = () => { throw new Error("connect ECONNREFUSED"); }; };
const bodyOf = (call: Sent) => JSON.parse(String(call.init.body));
const text = async (res: Response) => ({ status: res.status, text: await res.text(), headers: res.headers });

describe("bridgeProxy", () => {
  test("hands the answer back unchanged: status, body and content type; JSON when the bridge named none", async () => {
    upstream = () => new Response("plain", { status: 418, headers: { "content-type": "text/plain" } });
    const res = await bridge.bridgeProxy("/x");
    expect(await text(res)).toMatchObject({ status: 418, text: "plain" });
    expect(res.headers.get("content-type")).toBe("text/plain");

    upstream = () => new Response("{}", { headers: {} });
    expect((await bridge.bridgeProxy("/x")).headers.get("content-type")).toContain("application/json");
    expect(sent[0]!.url).toBe("http://bridge.test/x");
  });

  test("copies only the headers it was told to, and sets its own fixed ones", async () => {
    upstream = () => new Response("a", { headers: { "content-type": "audio/mpeg", "x-keep": "1", "x-secret": "internal", "set-cookie": "a=b" } });
    const res = await bridge.bridgeProxy("/x", {}, { copyHeaders: ["x-keep"], headers: { "Cache-Control": "no-store" } });
    expect([res.headers.get("x-keep"), res.headers.get("x-secret"), res.headers.get("set-cookie"), res.headers.get("cache-control")]).toEqual(["1", null, null, "no-store"]);
  });

  test("a dead bridge is a 502 naming the target, not a thrown error", async () => {
    down();
    const res = await bridge.bridgeProxy("/x");
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toBe("The skills bridge is not reachable (http://bridge.test): connect ECONNREFUSED");
  });
});

describe("bridgeAction", () => {
  const act = (extra?: Record<string, unknown>) => bridge.bridgeAction("/x", bridge.jsonPost({ a: 1 }), (body: any) => ({ done: body.value }), extra);

  test("an ok answer goes through onOk; a refusal becomes a failure with the bridge's own message and the extra data", async () => {
    upstream = () => Response.json({ value: 7 });
    expect(await act()).toEqual({ done: 7 });
    expect(sent[0]!.init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(bodyOf(sent[0]!)).toEqual({ a: 1 });

    upstream = () => Response.json({ error: "This question is already answered" }, { status: 409 });
    expect(await act({ id: "q1" })).toMatchObject({ status: 409, data: { id: "q1", error: "This question is already answered" } });

    upstream = () => new Response("<html>bad gateway</html>", { status: 502 });
    expect(await act()).toMatchObject({ status: 502, data: { error: "The skills bridge returned an error." } });
  });

  test("a dead bridge is a 503 failure that still carries the row id", async () => {
    down();
    expect(await act({ id: "q1" })).toMatchObject({ status: 503, data: { id: "q1", error: expect.stringContaining("not reachable") } });
  });
});

describe("the forwarding routes", () => {
  const post = async (path: string, init: Parameters<typeof makeEvent>[0] = {}, method = "POST") => (await route(path))[method](makeEvent({ method, ...init }));

  test("a quick action only runs, dismisses or restores, with its id encoded into the path", async () => {
    expect((await post("api/actions/[id]/[op]", { params: { id: "x", op: "delete" } })).status).toBe(404);
    expect(sent).toEqual([]);
    await post("api/actions/[id]/[op]", { params: { id: "../skills/x", op: "run" } });
    expect(sent[0]!.url).toBe("http://bridge.test/api/actions/..%2Fskills%2Fx/run");
    expect(sent[0]!.init.method).toBe("POST");
  });

  test("chat needs a text message, sends it trimmed with only the known fields and a page origin", async () => {
    for (const body of [{}, { message: "  " }, { message: 5 }, { message: ["hi"] }]) expect((await post("api/chat", { json: body })).status).toBe(400);
    expect((await post("api/chat", { body: "{oops" })).status).toBe(400);
    expect(sent).toEqual([]);

    await post("api/chat", { json: { message: " hi ", conversation_id: "c1", context: { route: "/" }, secret_field: "x" } });
    expect(bodyOf(sent[0]!)).toEqual({ message: "hi", conversation_id: "c1", context: { route: "/" }, origin: "page" });
  });

  test("a note write is passed on with its method, path, query and body, and a read or delete carries no body", async () => {
    const notes = async (method: string, path: string | undefined, search = "", body?: string) =>
      (await route("api/notes/[...path]"))[method](makeEvent({ method, path: `/api/notes${search}`, params: { path: path ?? "" }, body }));

    await notes("POST", undefined, "", '{"content":"x"}');
    await notes("PATCH", "abc", "", '{"scope":"intel"}');
    await notes("GET", undefined, "?scope=intel&query=milk");
    await notes("DELETE", "abc", "", '{"ignored":true}');
    await notes("POST", "abc/restore", "", "");

    expect(sent.map((s) => [s.init.method, s.url, s.init.body ?? null])).toEqual([
      ["POST", "http://bridge.test/api/notes", '{"content":"x"}'],
      ["PATCH", "http://bridge.test/api/notes/abc", '{"scope":"intel"}'],
      ["GET", "http://bridge.test/api/notes?scope=intel&query=milk", null],
      ["DELETE", "http://bridge.test/api/notes/abc", null],
      ["POST", "http://bridge.test/api/notes/abc/restore", null],
    ]);
    expect(new Headers(sent[0]!.init.headers).get("content-type")).toBe("application/json");
    expect(sent[2]!.init.headers).toBeUndefined();
  });

  test("report audio checks the date and the 16-hex chapter key before it asks, and streams the mp3 with its headers", async () => {
    const chapter = async (date: string, key: string) => post("api/report-audio/[date]/[key]", { params: { date, key } });
    for (const [date, key] of [["nope", "0123456789abcdef"], ["2026-10-05", "short"], ["2026-10-05", "0123456789ABCDEF"], ["2026-10-05", "0123456789abcdef/../x"]]) {
      expect((await chapter(date!, key!)).status).toBe(400);
    }
    expect((await post("api/report-audio/[date]", { params: { date: "2026-10-5" } }, "GET")).status).toBe(400);
    expect(sent).toEqual([]);

    upstream = () => new Response("mp3", { headers: { "content-type": "audio/mpeg", "content-length": "3", "x-audio-duration-ms": "900", "cache-control": "public" } });
    const res = await chapter("2026-10-05", "0123456789abcdef");
    expect(await text(res)).toMatchObject({ text: "mp3" });
    expect([res.headers.get("content-type"), res.headers.get("x-audio-duration-ms"), res.headers.get("cache-control")]).toEqual(["audio/mpeg", "900", "private, no-store"]);
    expect(sent[0]!.url).toBe("http://bridge.test/api/report-audio/2026-10-05/0123456789abcdef");

    await post("api/report-audio/[date]", { params: { date: "2026-10-05" } }, "GET");
    expect(sent[1]!.url).toBe("http://bridge.test/api/report-audio/2026-10-05");
  });

  test("a chapter is streamed as it is spoken, not held back until it is complete", async () => {
    let finish!: () => void;
    upstream = () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("first")); finish = () => controller.close(); },
    }), { headers: { "content-type": "audio/mpeg" } });
    const res = await post("api/report-audio/[date]/[key]", { params: { date: "2026-10-05", key: "0123456789abcdef" } });
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    finish();
    expect((await reader.read()).done).toBe(true);
  });

  test("server status is online only when the bridge answers ok", async () => {
    const online = async () => ((await (await route("api/server-status")).GET()).json() as Promise<{ online: boolean }>);
    expect(await online()).toEqual({ online: true });
    upstream = () => new Response("no", { status: 500 });
    expect(await online()).toEqual({ online: false });
    down();
    expect(await online()).toEqual({ online: false });
  });
});

describe("the assistant stream relay", () => {
  const chat = async (json: unknown = { message: "hi" }) => (await route("api/assistant/chat")).POST(makeEvent({ json }));
  const sse = (...frames: string[]) => new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });

  test("passes the event stream through with streaming headers", async () => {
    upstream = () => sse("event: tool\ndata: {}\n\n", "event: done\ndata: {}\n\n");
    const res = await chat();
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(await res.text()).toBe("event: tool\ndata: {}\n\nevent: done\ndata: {}\n\n");
    expect(sent[0]!.url).toBe("http://bridge.test/api/assistant/chat");
    expect(sent[0]!.init.body).toBe('{"message":"hi"}');
  });

  test("a validation failure from the bridge comes back as the JSON it was, not as a stream", async () => {
    upstream = () => Response.json({ error: "message is required" }, { status: 400 });
    const res = await chat({});
    expect(await text(res)).toMatchObject({ status: 400, text: '{"error":"message is required"}' });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("a dead bridge is a 502", async () => {
    down();
    expect((await chat()).status).toBe(502);
  });

  test("a stream that breaks halfway ends with one error frame for the widget", async () => {
    upstream = () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("event: tool\ndata: {}\n\n")); },
      pull() { throw new Error("socket hang up"); },
    }), { headers: { "content-type": "text/event-stream" } });
    const body = await (await chat()).text();
    expect(body).toContain("event: tool");
    expect(body).toContain('event: error\ndata: {"type":"error","message":"socket hang up"}');
  });

  test("a shutdown signal ends an open stream with a restart frame and aborts the bridge call; new turns are refused", async () => {
    const exit = spyOn(process, "exit").mockImplementation((() => undefined) as never);
    let aborted = false;
    upstream = (_url, init) => {
      init.signal!.addEventListener("abort", () => { aborted = true; });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("event: tool\ndata: {}\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
    };
    const res = await chat();
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: tool");

    shutdown.installShutdownHandlers();
    process.emit("SIGTERM" as any);
    const rest = new TextDecoder().decode((await reader.read()).value);
    expect(rest).toContain('event: error\ndata: {"type":"error","message":"The dashboard restarted and cut this turn short.');
    expect((await reader.read()).done).toBe(true);
    expect(aborted).toBe(true);
    expect(shutdown.isShuttingDown()).toBe(true);

    const refused = await chat();
    expect(refused.status).toBe(503);
    exit.mockRestore();
  });
});

describe("the question and skill form actions", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";
  const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, v); return makeEvent({ body: data }); };

  test("an answer needs an id that is a UUID and some text, and is sent to that question only", async () => {
    expect(await questions.actions.answer(form({ id: UUID, answer: "  " }) as any)).toMatchObject({ status: 400 });
    expect(await questions.actions.dismiss(form({ id: "../x" }) as any)).toMatchObject({ status: 400, data: { error: "Invalid question id" } });
    expect(sent).toEqual([]);

    expect(await questions.actions.answer(form({ id: UUID, answer: " Yes " }) as any)).toEqual({ id: UUID, op: "answer" });
    expect([sent[0]!.url, bodyOf(sent[0]!)]).toEqual([`http://bridge.test/api/questions/${UUID}/answer`, { answer: "Yes" }]);
    await questions.actions.reopen(form({ id: UUID }) as any);
    expect(sent[1]!.url).toBe(`http://bridge.test/api/questions/${UUID}/reopen`);
  });

  test("a skill switch needs a name, which is encoded into the path, and sends the boolean flag", async () => {
    expect(await skills.actions.update(form({ skillName: "" }) as any)).toMatchObject({ status: 400 });
    expect(sent).toEqual([]);
    await skills.actions.update(form({ skillName: "../api/pipeline/run", enabled: "true" }) as any);
    expect([sent[0]!.url, sent[0]!.init.method, bodyOf(sent[0]!)]).toEqual(["http://bridge.test/skills/..%2Fapi%2Fpipeline%2Frun", "PATCH", { enabled: true }]);
    await skills.actions.update(form({ skillName: "add_note" }) as any);
    expect(bodyOf(sent[1]!)).toEqual({ enabled: false });
  });

  test("resolving a pending call needs an id and a real decision, encodes the id, and reports what happened", async () => {
    expect(await skills.actions.resolve(form({ decision: "confirm" }) as any)).toMatchObject({ status: 400, data: { error: "Missing execution id" } });
    for (const decision of ["", "approve", "CONFIRM", "confirm/../x"]) expect(await skills.actions.resolve(form({ id: "e1", decision }) as any)).toMatchObject({ status: 400, data: { error: "Invalid decision" } });
    expect(sent).toEqual([]);

    upstream = () => Response.json({ status: "executed", result: "Added" });
    expect(await skills.actions.resolve(form({ id: "e/1", decision: "confirm", reason: "ok" }) as any)).toEqual({ ok: true, message: "Ran it: Added" });
    expect([sent[0]!.url, bodyOf(sent[0]!)]).toEqual(["http://bridge.test/api/skills/executions/e%2F1/confirm", { reason: "ok" }]);

    upstream = () => Response.json({ status: "rejected", reason: "not now" });
    expect(await skills.actions.resolve(form({ id: "e1", decision: "reject" }) as any)).toEqual({ ok: true, message: "Rejected: not now" });
  });
});
