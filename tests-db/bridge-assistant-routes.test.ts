// The rest of the skills bridge: chat (JSON and SSE), the surface registry, the pipeline trigger and
// deepen, report audio, context corrections and the skill switches. The model turn, the pipeline
// run, TTS and the skill gate are stubbed (fixtures/bridge.ts); stores and SQL are real.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";
import { AudioError, calls, loadBridge, resetStubs, stub } from "./fixtures/bridge";

const database = await useTestDatabase();
const { call } = await loadBridge();
const { SURFACES_LIST } = await import("../src/ai/surfaces");
const { listSkills } = await import("../src/skills/loader");

const UUID = "11111111-1111-4111-8111-111111111111";
const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  resetStubs();
  await database.sql`truncate context_corrections, disabled_skills, enabled_skills cascade`;
});

const names = () => calls.map(([name]) => name);

describe("POST /api/chat", () => {
  test("a message is required and a conversation id must be a UUID", async () => {
    for (const body of [{}, { message: "   " }, { message: 5 }, { message: ["hi"] }, { message: "hi", conversation_id: "not-a-uuid" }, { message: "hi", conversation_id: 7 }]) {
      const res = await call("/api/chat", { method: "POST", json: body });
      expect(res.status).toBe(400);
    }
    expect((await call("/api/chat", { method: "POST", body: "{broken" })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("the turn gets the trimmed message, the conversation, the page context and the origin", async () => {
    const context = { route: "/notes" };
    const res = await call("/api/chat", { method: "POST", json: { message: "  what is due?  ", conversation_id: UUID, context } });
    expect(await res.json()).toEqual({ reply: "hello" });
    expect(calls).toEqual([["sendMessage", ["what is due?", UUID, context, "page"]]]);

    await call("/api/chat", { method: "POST", json: { message: "again", origin: "widget" } });
    expect(calls[1]![1]![3]).toBe("widget");
  });

  test("a failing turn is a 500 carrying its message", async () => {
    stub.sendMessage = async () => { throw new Error("model unavailable"); };
    const res = await call("/api/chat", { method: "POST", json: { message: "hi" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "model unavailable" });
  });
});

describe("GET /api/assistant/surfaces", () => {
  test("lists every surface with its label, hints and skills, and the notice or null", async () => {
    const body = (await (await call("/api/assistant/surfaces")).json()) as Record<string, Record<string, unknown>>;
    expect(Object.keys(body).sort()).toEqual([...SURFACES_LIST].sort());
    for (const surface of SURFACES_LIST) {
      expect(Object.keys(body[surface]!).sort()).toEqual(["hints", "label", "notice", "skills"]);
      expect(Array.isArray(body[surface]!.skills)).toBe(true);
    }
  });
});

describe("POST /api/assistant/chat (server-sent events)", () => {
  test("validation failures are plain JSON 400s, not a stream", async () => {
    const res = await call("/api/assistant/chat", { method: "POST", json: { message: 5 } });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(calls).toEqual([]);
  });

  test("each event of the turn is one frame named by its type, with the widget as default origin", async () => {
    stub.streamMessage = async function* () {
      yield { type: "tool", name: "add_note" };
      yield { type: "done", reply: "Saved" };
    };
    const res = await call("/api/assistant/chat", { method: "POST", json: { message: " save it ", conversation_id: UUID } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain(`event: tool\ndata: ${JSON.stringify({ type: "tool", name: "add_note" })}`);
    expect(text).toContain(`event: done\ndata: ${JSON.stringify({ type: "done", reply: "Saved" })}`);
    expect(calls).toEqual([["streamMessage", ["save it", UUID, undefined, "widget"]]]);
  });

  test("a turn that throws ends the stream with one error frame instead of dropping the connection", async () => {
    stub.streamMessage = async function* () {
      yield { type: "tool", name: "add_note" };
      throw new Error("flex capacity gone");
    };
    const text = await (await call("/api/assistant/chat", { method: "POST", json: { message: "hi" } })).text();
    expect(text).toContain(`event: error\ndata: ${JSON.stringify({ type: "error", message: "flex capacity gone" })}`);
  });
});

describe("pipeline routes", () => {
  test("run starts today's pipeline without waiting for it, and a crash in it does not reach the caller", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    stub.runPipeline = () => Promise.reject(new Error("pipeline blew up"));
    const res = await call("/api/pipeline/run", { method: "POST" });
    const body = (await res.json()) as { status: string; date: string };
    await Bun.sleep(5);

    expect(res.status).toBe(200);
    expect(body.status).toBe("started");
    expect(body.date).toBe(new Date().toISOString().slice(0, 10));
    expect(calls).toEqual([["runPipeline", [body.date]]]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  test("deepen keeps only UUIDs, at most ten, and refuses a request with none", async () => {
    const none = await call("/api/deepen", { method: "POST", json: { ids: ["abc", 5, null] } });
    expect(none.status).toBe(400);
    expect((await call("/api/deepen", { method: "POST", json: {} })).status).toBe(400);
    expect(calls).toEqual([]);

    const many = Array.from({ length: 14 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const res = await call("/api/deepen", { method: "POST", json: { ids: ["junk", ...many] } });
    expect(await res.json()).toEqual({ text: "deepened text" });
    expect(calls).toEqual([["deepen", [many.slice(0, 10)]]]);
  });
});

describe("report audio", () => {
  test("the manifest needs a calendar date", async () => {
    expect((await call("/api/report-audio/yesterday")).status).toBe(400);
    expect(await (await call("/api/report-audio/2026-10-05")).json()).toEqual({ voice: "cedar", chapters: [] });
    expect(calls).toEqual([["audioManifest", ["2026-10-05"]]]);
  });

  test("a chapter is spoken only for a valid date and a 16-hex key, and comes back as private mp3", async () => {
    for (const path of ["/api/report-audio/nope/0123456789abcdef", "/api/report-audio/2026-10-05/short", "/api/report-audio/2026-10-05/0123456789ABCDEF", "/api/report-audio/2026-10-05/0123456789abcdeg"]) {
      expect((await call(path, { method: "POST" })).status).toBe(400);
    }
    expect(calls).toEqual([]);

    const res = await call("/api/report-audio/2026-10-05/0123456789abcdef", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("content-length")).toBe("9");
    expect(res.headers.get("x-audio-duration-ms")).toBe("1200");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("mp3-bytes");
  });

  test("a reader-facing audio error keeps its status; any other failure is a generic 502 that leaks nothing", async () => {
    stub.chapterAudio = async () => { throw new AudioError("That report has no such chapter", 404); };
    const missing = await call("/api/report-audio/2026-10-05/0123456789abcdef", { method: "POST" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "That report has no such chapter" });

    const log = spyOn(console, "error").mockImplementation(() => {});
    stub.chapterAudio = async () => { throw new Error("401 invalid api key sk-test"); };
    const broken = await call("/api/report-audio/2026-10-05/0123456789abcdef", { method: "POST" });
    log.mockRestore();
    expect(broken.status).toBe(502);
    expect(await broken.json()).toEqual({ error: "The voice could not be generated. Try again." });
  });
});

describe("/api/context/corrections", () => {
  const post = (json: unknown) => call("/api/context/corrections", { method: "POST", json });
  const rows = async () => (await database.sql`select target_kind, target_key, operation, statement, rationale, source, status from context_corrections`) as Record<string, any>[];

  test("records a correction from the dashboard, as source dashboard unless told otherwise", async () => {
    const res = await post({ target_kind: "document", target_key: "section 3", operation: "complement", statement: "  The office moved to Basel  ", rationale: "owner said so" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, applied: expect.any(String) });
    expect(await rows()).toEqual([{ target_kind: "document", target_key: "section 3", operation: "complement", statement: "The office moved to Basel", rationale: "owner said so", source: "dashboard", status: "active" }]);
  });

  test("a bad kind, operation or empty field is a 400 and records nothing; the default operation is amend", async () => {
    for (const body of [
      {}, { target_kind: "document", target_key: "k" }, { target_kind: "table", target_key: "k", statement: "s" },
      { target_kind: "document", target_key: "k", statement: "s", operation: "delete" }, { target_kind: "document", target_key: " ", statement: "s" },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(await rows()).toEqual([]);
    expect((await post({ target_kind: "document", target_key: "k", statement: "s" })).status).toBe(200);
    expect((await rows())[0]!.operation).toBe("amend");
  });

  test("reverting marks the correction reverted; a second revert and an unknown id are 409s", async () => {
    const { id } = (await (await post({ target_kind: "document", target_key: "k", statement: "s" })).json()) as { id: string };
    const res = await call(`/api/context/corrections/${id}/revert`, { method: "POST" });
    expect(await res.json()).toEqual({ ok: true, message: `Correction ${id} reverted.` });
    expect((await rows())[0]!.status).toBe("reverted");
    expect((await call(`/api/context/corrections/${id}/revert`, { method: "POST" })).status).toBe(409);
    expect((await call(`/api/context/corrections/${MISSING}/revert`, { method: "POST" })).status).toBe(409);
  });
});

describe("skills", () => {
  const patch = (name: string, json: unknown) => call(`/skills/${name}`, { method: "PATCH", json });
  const resolve = (decision: string, json: unknown = {}) => call(`/api/skills/executions/${UUID}/${decision}`, { method: "POST", json });

  test("the switch needs a real boolean and a registered skill", async () => {
    const [skill] = listSkills().filter((s) => s.default_enabled !== false);
    for (const enabled of ["false", 0, null, undefined]) expect((await patch(skill!.name, { enabled })).status).toBe(400);
    expect((await patch("no_such_skill", { enabled: false })).status).toBe(400);
    expect(await database.sql`select count(*)::int as n from disabled_skills`).toEqual([{ n: 0 }]);
  });

  test("turning a default-on skill off and on again shows in the list", async () => {
    const skill = listSkills().find((s) => s.default_enabled !== false)!;
    const enabledOf = async () => ((await (await call("/skills")).json()) as { name: string; enabled: boolean }[]).find((s) => s.name === skill.name)!.enabled;

    expect(await enabledOf()).toBe(true);
    expect(await (await patch(skill.name, { enabled: false })).json()).toMatchObject({ name: skill.name, enabled: false });
    expect(await enabledOf()).toBe(false);
    await patch(skill.name, { enabled: true });
    expect(await enabledOf()).toBe(true);
  });

  test("only confirm and reject are decisions, and the reason travels to the gate", async () => {
    expect((await resolve("approve")).status).toBe(400);
    expect(calls).toEqual([]);
    await resolve("reject", { reason: "not now" });
    expect(calls).toEqual([["resolvePendingSkill", [UUID, "reject", "not now"]]]);
  });

  test("each outcome of the gate maps to its own status", async () => {
    const outcome = async (result: { status: string; message: string }) => {
      stub.resolvePendingSkill = async () => result;
      const res = await resolve("confirm");
      return [res.status, await res.json()];
    };
    expect(await outcome({ status: "executed", message: "added" })).toEqual([200, { status: "executed", result: "added" }]);
    expect(await outcome({ status: "rejected", message: "no" })).toEqual([200, { status: "rejected", reason: "no" }]);
    expect(await outcome({ status: "unknown_skill", message: "gone" })).toEqual([404, { error: "gone" }]);
    expect(await outcome({ status: "failed", message: "boom" })).toEqual([500, { status: "failed", error: "boom" }]);
    expect(names()).toEqual(Array(4).fill("resolvePendingSkill"));
  });
});
