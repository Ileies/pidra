// The dashboard's own JSON endpoints against real SQL, called as handlers with a RequestEvent-shaped
// object: ratings, language settings, push subscriptions, the badge counts and read receipts, live
// pipeline status, raw mail on demand, search input handling and the context-builder switch (the
// process spawn is stubbed: a test must never start a real run).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const runner = { start: [] as unknown[], startResult: { ok: true } as { ok: boolean; error?: string }, stopResult: { ok: true } as { ok: boolean; error?: string } };
const database = await useTestDatabase();
setPrivateEnv();
const contextBuilderPath = Bun.resolveSync("../dashboard/src/lib/server/contextBuilder", import.meta.dir);
const realContextBuilder = await import(contextBuilderPath);
mock.module(contextBuilderPath, () => ({
  ...realContextBuilder,
  startRun: (mode: unknown) => { runner.start.push(mode); return runner.startResult; },
  stopRun: () => runner.stopResult,
}));

const handler = async (path: string, method: string) => (await import(`../dashboard/src/routes/${path}/+server`))[method];
const feedback = await handler("api/feedback", "POST");
const settingsGet = await handler("api/settings", "GET");
const settingsPatch = await handler("api/settings", "PATCH");
const pushPost = await handler("api/push/subscribe", "POST");
const pushDelete = await handler("api/push/subscribe", "DELETE");
const navBadges = await handler("api/nav-badges", "GET");
const reportRead = await handler("api/notifications/report-read/[date]", "POST");
const pipelineStatus = await handler("api/pipeline/status", "GET");
const rawContent = await handler("api/extractions/[id]/raw", "GET");
const extractionList = await handler("api/extractions", "GET");
const searchGet = await handler("api/search", "GET");
const health = await handler("api/health", "GET");
const cbStart = await handler("api/context-builder/start", "POST");
const cbStop = await handler("api/context-builder/stop", "POST");
const cbStatus = await handler("api/context-builder/status", "GET");

const UUID = "11111111-1111-4111-8111-111111111111";
const call = async (fn: (event: any) => Promise<Response> | Response, init: Parameters<typeof makeEvent>[0] = {}) => {
  const method = init.method ?? (init.json !== undefined || init.body !== undefined ? "POST" : "GET");
  const res = await fn(makeEvent({ ...init, method }));
  return { status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers };
};
const thrown = async (fn: () => unknown) => { try { await fn(); } catch (err) { return err as any; } return null; };

beforeEach(async () => {
  runner.start.length = 0;
  runner.startResult = { ok: true };
  runner.stopResult = { ok: true };
  await database.sql`truncate feedback_events, extractions, raw_items, user_settings, push_subscriptions, notification_reads, daily_reports, pipeline_runs, questions, skill_executions, context_builder_runs cascade`;
});

async function seedExtraction(rawContent = "Hello\r\n\r\n\r\n\r\nWorld") {
  const [raw] = await database.sql`insert into raw_items (run_date, source_type, source_name, raw_content) values ('2026-10-05', 'newsletter', 'Daily', ${rawContent}) returning id`;
  const [row] = await database.sql`insert into extractions (raw_item_id, run_date) values (${raw!.id}, '2026-10-05') returning id`;
  return row!.id as string;
}

describe("POST /api/feedback", () => {
  const ratings = async () => (await database.sql`select extraction_id, event_type, signal_value from feedback_events order by created_at`) as Record<string, any>[];

  test("a rating is stored once per extraction; rating again replaces it", async () => {
    const id = await seedExtraction();
    expect(await call(feedback, { json: { extraction_id: id, signal: "1" } })).toMatchObject({ status: 200, body: { rated: id, eventType: "explicit_plus" } });
    await call(feedback, { json: { extraction_id: ` ${id} `, signal: "-1" } });
    await call(feedback, { json: { extraction_id: id, signal: "-1" } });
    expect(await ratings()).toEqual([{ extraction_id: id, event_type: "explicit_minus", signal_value: -1 }]);
  });

  test("an id that is not a UUID or a signal other than 1 and -1 is a 400 and writes nothing", async () => {
    const id = await seedExtraction();
    for (const body of [{}, { signal: "1" }, { extraction_id: "abc", signal: "1" }, { extraction_id: id }, { extraction_id: id, signal: 1 }, { extraction_id: id, signal: "2" }, { extraction_id: id, signal: "0" }]) {
      expect((await call(feedback, { json: body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(feedback, { method: "POST", body: "{oops" })).status).toBe(400);
    expect((await call(feedback, { method: "POST", body: "null" })).status).toBe(400);
    expect(await ratings()).toEqual([]);
  });

  test("an extraction that no longer exists is a 404, which the offline outbox parks instead of retrying first in line forever", async () => {
    const res = await call(feedback, { json: { extraction_id: UUID, signal: "1" } });
    expect(res).toMatchObject({ status: 404, body: { error: "Extraction not found" } });
    expect(await ratings()).toEqual([]);
  });
});

describe("/api/settings", () => {
  const load = async () => (await call(settingsGet)).body;
  const patch = (body: unknown) => call(settingsPatch, { method: "PATCH", json: body });

  test("answers with the defaults before anything is saved", async () => {
    expect(await load()).toEqual({ uiLanguage: "en", contentLanguage: "en" });
  });

  test("saves one field and keeps the stored value of the other", async () => {
    const first = await patch({ uiLanguage: "de" });
    expect(first.body).toEqual({ uiLanguage: "de", contentLanguage: "en" });
    expect((await patch({ contentLanguage: "fr" })).body).toEqual({ uiLanguage: "de", contentLanguage: "fr" });
    expect(await load()).toEqual({ uiLanguage: "de", contentLanguage: "fr" });
    expect(await database.sql`select count(*)::int as n from user_settings`).toEqual([{ n: 1 }]);
  });

  test("a code outside the allowlist, of the wrong type or from the wrong list is a 400 that changes nothing", async () => {
    await patch({ uiLanguage: "de", contentLanguage: "fr" });
    for (const body of [{ uiLanguage: "xx" }, { contentLanguage: "klingon" }, { uiLanguage: 5 }, { uiLanguage: null }, { uiLanguage: "de'; drop table user_settings;--" }, { uiLanguage: "DE" }]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await load()).toEqual({ uiLanguage: "de", contentLanguage: "fr" });
  });
});

describe("/api/push/subscribe", () => {
  const sub = (over: Record<string, unknown> = {}) => ({ endpoint: "https://push.example.test/abc", keys: { p256dh: "pk", auth: "au" }, ...over });
  const rows = async () => (await database.sql`select endpoint, p256dh, auth from push_subscriptions`) as Record<string, any>[];

  test("stores a browser's subscription once per endpoint and removes it on request", async () => {
    expect((await call(pushPost, { json: sub() })).body).toEqual({ ok: true });
    await call(pushPost, { json: sub() });
    expect(await rows()).toEqual([{ endpoint: "https://push.example.test/abc", p256dh: "pk", auth: "au" }]);

    expect((await call(pushDelete, { method: "DELETE", json: { endpoint: "https://push.example.test/abc" } })).body).toEqual({ ok: true });
    expect(await rows()).toEqual([]);
  });

  test("a subscription without an endpoint or either key is a 400, and so is a delete without an endpoint", async () => {
    for (const body of [sub({ endpoint: "" }), sub({ keys: { p256dh: "pk" } }), sub({ keys: { auth: "au" } }), sub({ keys: undefined }), {}]) {
      expect((await call(pushPost, { json: body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(pushDelete, { method: "DELETE", json: {} })).status).toBe(400);
    for (const raw of ["", "{oops", "null", "\"text\""]) {
      expect((await call(pushPost, { method: "POST", body: raw })).status, raw).toBe(400);
      expect((await call(pushDelete, { method: "DELETE", body: raw })).status, raw).toBe(400);
    }
    expect(await rows()).toEqual([]);
  });
});

describe("badges and read receipts", () => {
  const badges = async () => (await call(navBadges)).body;

  test("count unread reports, open questions, pending skill calls and unreviewed runs", async () => {
    expect(await badges()).toEqual({ hasPendingQuestions: false, navBadges: { "/": 0, "/questions": 0, "/runs": 0, "/skills": 0 } });

    await database.sql`insert into daily_reports (report_date, full_report) values ('2026-10-04', 'a'), ('2026-10-05', 'b')`;
    await database.sql`insert into questions (kind, question, first_asked, last_asked, status) values ('chat', 'Q1', '2026-10-01', '2026-10-01', 'open'), ('chat', 'Q2', '2026-10-01', '2026-10-01', 'dismissed')`;
    await database.sql`insert into skill_executions (run_date, skill_name, status) values ('2026-10-05', 'add_note', 'pending'), ('2026-10-05', 'add_note', 'executed')`;
    await database.sql`insert into pipeline_runs (run_date, status) values ('2026-10-03', 'failed'), ('2026-10-04', 'completed')`;
    await database.sql`insert into pipeline_runs (run_date, status, step_errors) values ('2026-10-05', 'completed', '[{"step":"x"}]'::jsonb)`;

    expect(await badges()).toEqual({ hasPendingQuestions: true, navBadges: { "/": 2, "/questions": 1, "/runs": 2, "/skills": 1 } });
  });

  test("reading a report clears its badge, a repeat is harmless, a bad date is a 400", async () => {
    await database.sql`insert into daily_reports (report_date, full_report) values ('2026-10-04', 'a'), ('2026-10-05', 'b')`;
    const read = (date: string) => reportRead(makeEvent({ params: { date } }));

    expect((await read("2026-10-05")).status).toBe(204);
    expect((await read("2026-10-05")).status).toBe(204);
    expect((await badges() as any).navBadges["/"]).toBe(1);
    expect(await database.sql`select count(*)::int as n from notification_reads`).toEqual([{ n: 1 }]);
    await database.sql`update notification_reads set read_at = now() - interval '1 day'`;
    await read("2026-10-05");
    expect((await database.sql`select read_at > now() - interval '1 minute' as fresh from notification_reads`)[0]!.fresh).toBe(true);

    for (const date of ["yesterday", "2026-10-5", "2026-10-05'--", ""]) {
      expect((await thrown(() => read(date)))?.status, date).toBe(400);
    }
  });
});

describe("GET /api/pipeline/status", () => {
  const status = (date?: string) => call(pipelineStatus, { path: date === undefined ? "/" : `/?date=${encodeURIComponent(date)}` });

  test("needs a calendar date", async () => {
    for (const date of [undefined, "", "today", "2026-10-5"]) expect((await status(date)).status).toBe(400);
  });

  test("says whether the report exists and describes the newest run of the day", async () => {
    expect((await status("2026-10-05")).body).toEqual({ hasReport: false, run: null });

    await database.sql`insert into pipeline_runs (run_date, status, failed_step, started_at, step_errors) values ('2026-10-05', 'failed', 'phase2', now() - interval '2 hours', '[{"step":"old"}]'::jsonb)`;
    await database.sql`insert into pipeline_runs (run_date, status, started_at, duration_ms) values ('2026-10-05', 'completed', now() - interval '1 hour', 4200)`;
    await database.sql`insert into daily_reports (report_date, full_report) values ('2026-10-05', 'b')`;

    const { body } = await status("2026-10-05");
    expect(body).toMatchObject({ hasReport: true, run: { status: "completed", failedStep: null, stepErrors: [], durationMs: 4200 } });
    expect((await status("2026-10-04")).body).toEqual({ hasReport: false, run: null });
  });
});

describe("raw mail on demand and the extraction list", () => {
  test("raw content is tidied, never cached, and an unknown or malformed id is a 404 or 400", async () => {
    const id = await seedExtraction("Hello\r\n\r\n\r\n\r\nWorld");
    const res = await call(rawContent, { params: { id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((res.body as any).rawContent).toBe("Hello\n\nWorld");

    expect((await call(rawContent, { params: { id: UUID } })).status).toBe(404);
    expect((await call(rawContent, { params: { id: "abc" } })).status).toBe(400);
    expect((await call(rawContent, { params: { id: `${id}' or '1'='1` } })).status).toBe(400);
  });

  test("the list needs at least one valid id and never carries raw content", async () => {
    expect(await call(extractionList, { path: "/?ids=abc,def" })).toMatchObject({ status: 400, body: { items: [] } });
    expect((await call(extractionList, { path: "/" })).status).toBe(400);

    const id = await seedExtraction("secret raw body");
    const res = await call(extractionList, { path: `/?ids=${id},nonsense` });
    expect(res.status).toBe(200);
    expect((res.body as any).items).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("secret raw body");
  });
});

describe("search and health", () => {
  test("a query under two characters is an empty answer without touching the database", async () => {
    for (const q of ["", " ", "a", " a "]) expect((await call(searchGet, { path: `/?q=${encodeURIComponent(q)}` })).body).toEqual({ hits: [] });
    expect((await call(searchGet)).body).toEqual({ hits: [] });
  });

  test("finds a note by its words, prefix-matched, and punctuation in the query cannot break the SQL", async () => {
    await database.sql`insert into notes (content, scope, created_by) values ('Export controls apply to the Basel shipment', 'global', 'user')`;
    const hits = async (q: string) => ((await call(searchGet, { path: `/?q=${encodeURIComponent(q)}` })).body as { hits: { kind: string }[] }).hits;
    expect((await hits("export cont")).map((h) => h.kind)).toEqual(["note"]);
    expect(await hits("zzzzqq")).toEqual([]);
    for (const q of ["'; drop table notes;--", "a & | ! ( ) :*", "\\", "%%", "<script>"]) expect(Array.isArray(await hits(q))).toBe(true);
    expect(await database.sql`select count(*)::int as n from notes`).toEqual([{ n: 1 }]);
  });

  test("health needs no database and is never cached", async () => {
    const res = await call(health);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the context builder switch", () => {
  const start = (body?: unknown) => call(cbStart, { json: body });

  test("start passes only full or update on, anything else lets the builder choose", async () => {
    await start({ mode: "full" });
    await start({ mode: "update" });
    for (const mode of ["FULL", "rm -rf", 3, null, undefined]) await start({ mode });
    await call(cbStart, { method: "POST", body: "{oops" });
    expect(runner.start).toEqual(["full", "update", null, null, null, null, null, null]);
  });

  test("start refuses while a run is recorded as running, and when the spawn is refused, without spawning twice", async () => {
    await database.sql`insert into context_builder_runs (mode, status) values ('full', 'running')`;
    expect(await start({ mode: "full" })).toMatchObject({ status: 409, body: { ok: false, error: "A run is already in progress." } });
    expect(runner.start).toEqual([]);

    await database.sql`update context_builder_runs set status = 'completed'`;
    runner.startResult = { ok: false, error: "A run is already active" };
    expect(await start({})).toMatchObject({ status: 409, body: { ok: false, error: "A run is already active" } });
    runner.startResult = { ok: true };
    expect(await start({})).toMatchObject({ status: 200, body: { ok: true } });
  });

  test("stop is a 409 when nothing is tracked, and status reports the latest recorded run", async () => {
    runner.stopResult = { ok: false, error: "No dashboard-tracked run to stop" };
    expect(await call(cbStop, { method: "POST" })).toMatchObject({ status: 409, body: { ok: false } });
    runner.stopResult = { ok: true };
    expect((await call(cbStop, { method: "POST" })).status).toBe(200);

    expect((await call(cbStatus)).body).toMatchObject({ running: false, dbRun: null, trackedByDashboard: false });
    await database.sql`insert into context_builder_runs (mode, status) values ('update', 'running')`;
    expect((await call(cbStatus)).body).toMatchObject({ running: true, dbRun: { mode: "update", status: "running" } });
  });
});
