// The skills bridge (src/server/index.ts) driven with real Requests: the SMS webhook's secret
// check, the shared plumbing (uuid guard, CORS, error mapping) and the three write surfaces the
// dashboard proxies to (questions, quick actions, notes). Stores and SQL are real; see fixtures/bridge.ts.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";
import { calls, loadBridge, resetStubs, stub } from "./fixtures/bridge";

const database = await useTestDatabase();
const { call } = await loadBridge();
const { db, questions, reportActions } = await import("../src/db");

const MISSING = "00000000-0000-4000-8000-000000000000";
const SECRET = "s3cret-for-tests";

beforeEach(async () => {
  resetStubs();
  delete process.env.SMS_WEBHOOK_SECRET;
  await database.sql`truncate raw_items, questions, report_actions, skill_executions, notes cascade`;
});

const smsRows = async () => (await database.sql`select source_type, source_name, message_id, raw_content, run_date::text as run_date from raw_items`) as Record<string, any>[];
const sms = (body: unknown, secret?: string) =>
  call("/webhook/sms", { method: "POST", json: body, headers: secret === undefined ? {} : { "X-SMS-Secret": secret } });

describe("POST /webhook/sms", () => {
  test("rejects every request while SMS_WEBHOOK_SECRET is unset, whatever header is sent, and stores nothing", async () => {
    for (const secret of [undefined, "", SECRET, "undefined"]) {
      const res = await sms({ from: "+41790000000", body: "hi" }, secret);
      expect(res.status).toBe(401);
    }
    expect(await smsRows()).toEqual([]);
  });

  test("rejects a missing or wrong secret, even a prefix of the right one, and stores nothing", async () => {
    process.env.SMS_WEBHOOK_SECRET = SECRET;
    for (const secret of [undefined, "", "wrong", SECRET.slice(0, -1), `${SECRET}x`]) {
      expect((await sms({ from: "+41790000000", body: "hi" }, secret)).status).toBe(401);
    }
    expect(await smsRows()).toEqual([]);
  });

  test("stores a forwarded message as a raw sms item dated by its timestamp", async () => {
    process.env.SMS_WEBHOOK_SECRET = SECRET;
    const res = await sms({ from: " +41790000000 ", body: " Your code is 123456 ", timestamp: Date.UTC(2026, 9, 5, 23, 30) }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await smsRows()).toEqual([
      { source_type: "sms", source_name: "+41790000000", message_id: `sms:+41790000000:${Date.UTC(2026, 9, 5, 23, 30)}`, raw_content: "From: +41790000000\n\nYour code is 123456", run_date: "2026-10-05" },
    ]);
  });

  test("a retry of the same message is acknowledged as a duplicate and stored once", async () => {
    process.env.SMS_WEBHOOK_SECRET = SECRET;
    const payload = { from: "+41790000000", body: "hi", timestamp: 1_790_000_000_000 };
    expect(await (await sms(payload, SECRET)).json()).toEqual({ ok: true });
    const again = await sms(payload, SECRET);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await smsRows()).toHaveLength(1);
  });

  test("a message without sender or text, or a body that is not JSON, is a 400 and stores nothing", async () => {
    process.env.SMS_WEBHOOK_SECRET = SECRET;
    for (const body of [{ from: "+41790000000" }, { body: "hi" }, { from: "  ", body: "hi" }, {}]) {
      const res = await sms(body, SECRET);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing from or body" });
    }
    const garbled = await call("/webhook/sms", { method: "POST", body: "not json", headers: { "X-SMS-Secret": SECRET } });
    expect(garbled.status).toBe(400);
    expect(await smsRows()).toEqual([]);
  });
});

describe("the shared plumbing", () => {
  test("health answers, an unknown path is a 404", async () => {
    expect(await (await call("/api/health")).json()).toEqual({ status: "ok" });
    expect((await call("/api/nope")).status).toBe(404);
  });

  test("CORS is granted to the dashboard's dev origins and to nobody else", async () => {
    const preflight = (origin: string) => call("/api/health", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
    expect((await preflight("http://localhost:5173")).headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await preflight("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a path id that is not a UUID is refused before the handler runs", async () => {
    for (const path of ["/api/actions/abc/run", "/api/questions/abc/dismiss", "/api/context/corrections/abc/revert"]) {
      const res = await call(path, { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid id" });
    }
    expect(calls).toEqual([]);
  });

  test("a store's HttpError keeps its own status and message, anything else is a bare 500", async () => {
    const missing = await call(`/api/notes/${MISSING}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: `note ${MISSING} not found` });

    const notUuid = await call("/api/notes/abc", { method: "DELETE" });
    expect(notUuid.status).toBe(400);

    const log = spyOn(console, "error").mockImplementation(() => {});
    stub.deepen = async () => { throw new Error("secret internals"); };
    const boom = await call("/api/deepen", { method: "POST", json: { ids: [MISSING] } });
    log.mockRestore();
    expect(boom.status).toBe(500);
    expect(await boom.text()).toBe("Internal Server Error");
  });
});

describe("/api/questions", () => {
  const seed = async (over: Partial<typeof questions.$inferInsert> = {}) =>
    (await db.insert(questions).values({ kind: "chat", question: "Is the office open?", firstAsked: "2026-10-01", lastAsked: "2026-10-01", ...over }).returning())[0]!;
  const post = (id: string, op: string, json?: unknown) => call(`/api/questions/${id}/${op}`, { method: "POST", json });

  test("answering stores the trimmed answer, starts acting on it without waiting, and a second answer is a 409", async () => {
    const q = await seed();
    let release!: () => void;
    stub.processAnswer = () => new Promise<void>((resolve) => { release = resolve; });

    const res = await post(q.id, "answer", { answer: "  Yes, until 6 pm  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: q.id, status: "answered" });
    expect(calls.filter(([name]) => name === "processAnswer")).toEqual([["processAnswer", [q.id]]]);
    release();

    const [row] = await database.sql`select status, answer from questions where id = ${q.id}`;
    expect(row).toEqual({ status: "answered", answer: "Yes, until 6 pm" });
    expect((await post(q.id, "answer", { answer: "again" })).status).toBe(409);
  });

  test("an empty or non-string answer is a 400 and leaves the question open", async () => {
    const q = await seed();
    for (const answer of ["", "   ", 42, null, undefined]) {
      expect((await post(q.id, "answer", { answer })).status).toBe(400);
    }
    expect((await post(q.id, "answer")).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await database.sql`select status from questions where id = ${q.id}`)[0]!.status).toBe("open");
  });

  test("dismiss and reopen move the question along and a repeat is a 409; an unknown id is a 404", async () => {
    const q = await seed();
    expect(await (await post(q.id, "dismiss")).json()).toEqual({ id: q.id, status: "dismissed" });
    expect((await post(q.id, "dismiss")).status).toBe(409);
    expect(await (await post(q.id, "reopen")).json()).toEqual({ id: q.id, status: "open" });
    expect((await post(q.id, "reopen")).status).toBe(409);
    expect((await post(MISSING, "dismiss")).status).toBe(404);
  });

  test("reprocess re-runs an answer that was not acted on, refuses one that was, and refuses an open question", async () => {
    const stuck = await seed({ status: "answered", answer: "yes", answerStatus: "failed" });
    const acted = await seed({ question: "Another?", status: "answered", answer: "no", answerStatus: "done" });
    const open = await seed({ question: "Still open?" });

    expect(await (await post(stuck.id, "reprocess")).json()).toEqual({ id: stuck.id, status: "answered" });
    expect(calls).toEqual([["processAnswer", [stuck.id]]]);
    const refused = await post(acted.id, "reprocess");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "The answer was already acted on" });
    expect((await post(open.id, "reprocess")).status).toBe(409);
    expect(calls).toHaveLength(1);
  });

  test("an unknown operation is a 400", async () => {
    const res = await post(MISSING, "delete");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "op must be answer, dismiss, reopen or reprocess" });
  });
});

describe("/api/actions", () => {
  const seed = async (over: Partial<typeof reportActions.$inferInsert> = {}) =>
    (await db.insert(reportActions).values({
      runDate: "2026-10-05", kind: "add_todo", skillName: "add_todo_item", parameters: { title: "Call the bank" },
      preview: { kind: "add_todo", title: "Call the bank", due: null, notes: null }, sourceExtractionIds: [], ...over,
    }).returning())[0]!;
  const post = (id: string, op: string) => call(`/api/actions/${id}/${op}`, { method: "POST" });

  test("an operation other than run, dismiss or restore is a 400", async () => {
    const res = await post(MISSING, "delete");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "op must be run, dismiss or restore" });
  });

  test("dismiss and restore flip the proposal and say so; an unknown id is a 404", async () => {
    const action = await seed();
    expect(await (await post(action.id, "dismiss")).json()).toEqual({ id: action.id, status: "dismissed", message: "Dismissed" });
    expect(await (await post(action.id, "restore")).json()).toEqual({ id: action.id, status: "proposed", message: "Restored" });
    expect((await post(MISSING, "dismiss")).status).toBe(404);
  });

  test("run executes the skill as the owner and reports the outcome", async () => {
    const action = await seed();
    const res = await post(action.id, "run");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: action.id, status: "done" });
    expect(calls.map(([name, args]) => [name, args[0]])).toEqual([["executeSkill", "add_todo_item"]]);
  });
});

describe("/api/notes", () => {
  const create = async (content = "Remember the milk", extra: Record<string, unknown> = {}) => {
    const res = await call("/api/notes", { method: "POST", json: { content, scope: "personal", ...extra } });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, any>;
  };
  const patch = (id: string, json: unknown) => call(`/api/notes/${id}`, { method: "PATCH", json });

  test("a note is created as the user, listed, and a missing body is a 400", async () => {
    const note = await create(" Remember the milk ", { expires_at: "2099-01-01" });
    expect(note).toMatchObject({ content: "Remember the milk", scope: "personal", createdBy: "user" });
    expect(note.expiresAt).toBeTruthy();

    const list = (await (await call("/api/notes?scope=personal&query=milk")).json()) as unknown[];
    expect(list).toHaveLength(1);
    expect(await (await call("/api/notes?scope=intel")).json()).toEqual([]);
    expect((await call("/api/notes", { method: "POST", json: { content: "  " } })).status).toBe(400);
    expect((await call("/api/notes", { method: "POST", body: "not json" })).status).toBe(400);
  });

  test("a patch touches only the keys it names: absent expires_at is left alone, null clears it", async () => {
    const note = await create("Pay rent", { expires_at: "2099-01-01" });

    const edited = (await (await patch(note.id, { content: "Pay rent early" })).json()) as Record<string, any>;
    expect(edited).toMatchObject({ content: "Pay rent early", _conflict: false });
    expect(edited.expiresAt).toBeTruthy();

    const cleared = (await (await patch(note.id, { expires_at: null })).json()) as Record<string, any>;
    expect(cleared.expiresAt).toBeNull();
    expect(cleared.content).toBe("Pay rent early");
    expect((await patch(note.id, { content: "  " })).status).toBe(400);
  });

  test("an edit based on a stale version is applied anyway and flagged as a conflict", async () => {
    const note = await create("Version one");
    const second = (await (await patch(note.id, { content: "Version two" })).json()) as Record<string, any>;

    const stale = (await (await patch(note.id, { content: "Version three", base_updated_at: note.updatedAt })).json()) as Record<string, any>;
    expect(stale).toMatchObject({ content: "Version three", _conflict: true });

    const current = (await (await patch(note.id, { content: "Version four", base_updated_at: stale.updatedAt })).json()) as Record<string, any>;
    expect(current).toMatchObject({ content: "Version four", _conflict: false });
    expect(second.content).toBe("Version two");
  });

  test("delete, restore, history and revert go through the revision trail", async () => {
    const note = await create("First wording");
    await patch(note.id, { content: "Second wording" });

    expect((await (await call(`/api/notes/${note.id}`, { method: "DELETE" })).json() as any).deletedAt).toBeTruthy();
    expect(await (await call("/api/notes")).json()).toEqual([]);
    expect(await (await call("/api/notes?include=deleted")).json()).toHaveLength(1);
    expect(((await (await call(`/api/notes/${note.id}/restore`, { method: "POST" })).json()) as any).deletedAt).toBeNull();

    const history = (await (await call(`/api/notes/${note.id}/history`)).json()) as Record<string, any>[];
    expect(history.length).toBeGreaterThanOrEqual(3);
    const edit = history.find((r) => r.previousContent === "First wording")!;
    const reverted = (await (await call(`/api/notes/revisions/${edit.id}/revert`, { method: "POST" })).json()) as Record<string, any>;
    expect(reverted.content).toBe("First wording");
    expect((await call(`/api/notes/revisions/${MISSING}/revert`, { method: "POST" })).status).toBe(404);
  });
});
