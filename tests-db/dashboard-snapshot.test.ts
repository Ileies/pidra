// The offline snapshot endpoint (/api/offline/snapshot) against real SQL. The mirror lives on the
// owner's phone, so what may never leave the server is pinned here with marker strings planted in
// every table the endpoint must not read; then the cache: 304 on a known ETag, a delta of only the
// changed rows with every id, and a full body for an ETag this process does not know.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
setPrivateEnv();
const { GET } = await import("../dashboard/src/routes/api/offline/snapshot/+server");
const { assemble } = await import("../dashboard/src/lib/server/offline/snapshot");

const MARKERS = ["RAW-BODY-MARKER", "ERROR-DETAIL-MARKER", "CHAT-MARKER", "SKILL-RESULT-MARKER", "PUSH-ENDPOINT-MARKER", "EMAIL-PW-MARKER", "QUESTION-ANSWER-MARKER", "STEP-ERROR-HOST-MARKER", "PIN-HASH-MARKER", "SESSION-AGENT-MARKER"];

let clock: ReturnType<typeof spyOn<DateConstructor, "now">> | null = null;
let offset = 0; // never reset: the module-level fingerprint memo outlives a test
/** The fingerprint is memoised for five seconds; each pull after a change must be past that. */
function pastFingerprintCache() {
  offset += 6_000;
  clock?.mockRestore();
  const base = Date.now();
  clock = spyOn(Date, "now").mockReturnValue(base + offset);
}
afterEach(() => { clock?.mockRestore(); clock = null; });

async function seed() {
  const sql = database.sql;
  const [raw] = await sql`insert into raw_items (run_date, source_type, source_name, raw_content) values ('2026-10-05', 'newsletter', 'Daily', 'RAW-BODY-MARKER From: a@example.test') returning id`;
  const [ext] = await sql`insert into extractions (raw_item_id, run_date, extracted_json) values (${raw!.id}, '2026-10-05', ${JSON.stringify({ headline: "Headline One", key_claim: "A claim" })}::text::jsonb) returning id`;
  await sql`insert into daily_reports (report_date, full_report, short_summary) values ('2026-10-05', ${`## Today\n\nSomething happened.\n<!--refs:${ext!.id}-->\n`}, 'Short'), ('2026-10-04', 'Older report', 'Older')`;
  await sql`insert into pipeline_runs (run_date, status, failed_step, step_errors) values ('2026-10-05', 'failed', 'phase2', ${JSON.stringify([{ step: "phase1", error: "imap:work: connect ECONNREFUSED STEP-ERROR-HOST-MARKER:993" }])}::text::jsonb)`;
  await sql`insert into report_actions (run_date, kind, skill_name, parameters, preview, source_extraction_ids, status, status_detail) values
    ('2026-10-05', 'add_todo', 'add_todo_item', '{}'::jsonb, '{"kind":"add_todo","title":"Call","due":null,"notes":null}'::jsonb, '{}', 'failed', 'ERROR-DETAIL-MARKER'),
    ('2026-10-05', 'add_todo', 'add_todo_item', '{}'::jsonb, '{"kind":"add_todo","title":"Hidden","due":null,"notes":null}'::jsonb, '{}', 'dismissed', null)`;
  const [conversation] = await sql`insert into chat_conversations (title) values ('CHAT-MARKER title') returning id`;
  await sql`insert into chat_messages (conversation_id, role, content) values (${conversation!.id}, 'user', 'CHAT-MARKER message')`;
  await sql`insert into skill_executions (run_date, skill_name, status, result, parameters) values ('2026-10-05', 'add_note', 'executed', 'SKILL-RESULT-MARKER', '{"content":"SKILL-RESULT-MARKER"}'::jsonb)`;
  await sql`insert into push_subscriptions (endpoint, p256dh, auth) values ('https://PUSH-ENDPOINT-MARKER.example.test/x', 'k', 'a')`;
  await sql`insert into email_accounts (label, host, account_user, password) values ('Work', 'imap.example.test', 'me@example.test', 'EMAIL-PW-MARKER')`;
  await sql`insert into questions (kind, question, answer, first_asked, last_asked, status) values ('chat', 'Q?', 'QUESTION-ANSWER-MARKER', '2026-10-01', '2026-10-01', 'answered')`;
  await sql`insert into auth_pin (pin_hash) values ('PIN-HASH-MARKER')`;
  await sql`insert into auth_sessions (id, expires_at, user_agent) values ('s1', now() + interval '1 day', 'SESSION-AGENT-MARKER')`;
  await sql`insert into notes (content, scope, created_by) values ('A mirrored note', 'global', 'user')`;
  await sql`insert into contacts (identifier, name) values ('anna@example.test', 'Anna')`;
  await sql`insert into entities (name) values ('Acme Corp')`;
  await sql`insert into active_topics (headline, domain, first_seen, last_updated) values ('A topic', 'tech', '2026-10-01', '2026-10-05')`;
  return { extractionId: ext!.id as string };
}

beforeEach(async () => {
  await database.sql`truncate daily_reports, pipeline_runs, report_actions, raw_items, extractions, chat_conversations, skill_executions, push_subscriptions, email_accounts, questions, auth_pin, auth_sessions, notes, contacts, entities, active_topics, notification_reads, feedback_events cascade`;
});

describe("what may never leave the server", () => {
  test("none of the planted secrets appears anywhere in the assembled snapshot", async () => {
    await seed();
    const stores = await assemble();
    const wire = JSON.stringify(stores);
    for (const marker of MARKERS) expect(wire, marker).not.toContain(marker);
    expect(wire).toContain("A mirrored note");
    expect(wire).toContain("Acme Corp");
    expect(wire).toContain("anna@example.test");
  });

  test("a report carries its ingest failures as a source and a kind only, and the actions the reader may still see without their error text", async () => {
    await seed();
    const [report] = (await assemble()).reports as any[];
    expect(report.id).toBe("2026-10-05");
    expect(report.ingestFailures).toEqual([{ source: "imap:work", kind: expect.any(String) }]);
    expect(report.pipelineRun).toEqual({ status: "failed", failedStep: "phase2", startedAt: expect.anything(), completedAt: null, durationMs: null });
    expect(report.actions.map((a: any) => [a.status, a.preview.title])).toEqual([["failed", "Call"]]);
  });

  test("extractions carry the claim but not the stored mail body", async () => {
    const { extractionId } = await seed();
    const { extractions } = await assemble();
    expect(extractions.map((e: any) => e.id)).toEqual([extractionId]);
    expect(JSON.stringify(extractions)).toContain("Headline One");
    expect((extractions[0] as any).rawContent ?? null).toBeNull();
  });

  test("only the newest 60 report days are mirrored", async () => {
    for (let i = 0; i < 65; i++) await database.sql`insert into daily_reports (report_date, full_report) values (${new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)}, 'r')`;
    const { reports } = await assemble();
    expect(reports).toHaveLength(60);
    const dates = reports.map((r) => r.id).sort();
    expect([dates[0], dates[59]]).toEqual(["2026-01-06", "2026-03-06"]);
  });
});

describe("GET /api/offline/snapshot", () => {
  const pull = async (etag?: string) => {
    pastFingerprintCache();
    const res = await GET(makeEvent({ method: "GET", path: "/api/offline/snapshot", headers: etag ? { "if-none-match": etag } : {} }) as any);
    return { res, body: res.status === 304 ? null : ((await res.json()) as any) };
  };

  test("a first pull is the whole snapshot, never cached by the browser, with an ETag", async () => {
    await seed();
    const { res, body } = await pull();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBe(`"${body.etag}"`);
    expect(body).toMatchObject({ mode: "full", base: null });
    expect(Object.keys(body.stores).sort()).toEqual(["contacts", "contextDoc", "corrections", "entities", "entityAppearances", "extractions", "notes", "reports", "topics"]);
    for (const marker of MARKERS) expect(JSON.stringify(body), marker).not.toContain(marker);
  });

  test("a client that holds the current ETag gets a 304, plain or weak or among several", async () => {
    await seed();
    const { body } = await pull();
    for (const header of [`"${body.etag}"`, `W/"${body.etag}"`, `"stale", "${body.etag}"`]) {
      const second = await pull(header);
      expect(second.res.status, header).toBe(304);
      expect(second.res.headers.get("etag")).toBe(`"${body.etag}"`);
    }
  });

  test("after a change a known ETag gets only the changed rows, with every id so deletions propagate", async () => {
    await seed();
    const first = await pull();
    await database.sql`insert into notes (content, scope, created_by) values ('A second note', 'global', 'user')`;

    const second = await pull(`"${first.body.etag}"`);
    expect(second.body).toMatchObject({ mode: "delta", base: first.body.etag });
    expect(second.body.etag).not.toBe(first.body.etag);
    expect(second.body.stores.notes.map((n: any) => n.content)).toEqual(["A second note"]);
    expect(second.body.stores.reports).toEqual([]);
    expect(second.body.ids.notes).toHaveLength(2);
    expect(second.body.ids.reports).toEqual(first.body.ids.reports);

    await database.sql`delete from notes where content = 'A second note'`;
    const third = await pull(`"${second.body.etag}"`);
    expect(third.body.mode).toBe("delta");
    expect(third.body.stores.notes).toEqual([]);
    expect(third.body.ids.notes).toHaveLength(1);
  });

  test("a note carries its targeting and load history, and a new load alone makes it a changed row", async () => {
    await seed();
    await database.sql`update notes set steps = '{classify}', applies_to = '{"senders":["netcup"]}'::jsonb, active_from = '2030-01-01' where content = 'A mirrored note'`;
    const first = await pull();
    expect(first.body.stores.notes[0]).toMatchObject({
      steps: ["classify"], applies_to: { senders: ["netcup"] }, load_count: 0, last_loaded_on: null,
    });

    await database.sql`insert into note_loads (note_id, step, run_date) select id, 'classify', '2030-06-15' from notes`;
    const second = await pull(`"${first.body.etag}"`);
    expect(second.body.mode).toBe("delta");
    expect(second.body.stores.notes[0]).toMatchObject({ load_count: 1, last_loaded_on: "2030-06-15" });
  });

  test("an ETag this process has never seen (after a restart or a deploy) gets the full snapshot", async () => {
    await seed();
    const { body } = await pull(`"from-another-build-abc"`);
    expect(body.mode).toBe("full");
    expect(body.stores.notes).toHaveLength(1);
  });

  test("a rating, a read receipt and a run flipping to failed each change the snapshot", async () => {
    const { extractionId } = await seed();
    let etag = (await pull()).body.etag as string;
    const moved = async (change: () => Promise<unknown>) => {
      await change();
      const next = (await pull(`"${etag}"`)).body;
      expect(next?.etag, "etag moved").not.toBe(etag);
      etag = next.etag;
    };
    await moved(() => database.sql`insert into feedback_events (extraction_id, event_type, signal_value) values (${extractionId}, 'explicit_plus', 1)`);
    await moved(() => database.sql`delete from feedback_events`);
    await moved(() => database.sql`insert into notification_reads (notification_key, read_at) values ('report:2026-10-05', now())`);
    await moved(() => database.sql`update pipeline_runs set status = 'completed', failed_step = null`);
  });
});
