// The dashboard's remaining page form actions: rating, sources, runs, topics, chat management and
// the actions that only forward to the bridge. Real SQL for what writes Postgres; a stubbed `fetch`
// for the bridge, so what is asserted is the request each action builds and how it answers a refusal.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
setPrivateEnv();
const sql = database.sql;
const load = (path: string) => import(`../dashboard/src/routes/${path}/+page.server`);
const [date, detail, corrections, sources, source, entity, runs, topics, contacts, chat, closed] = await Promise.all([
  load("[date]"), load("[date]/detail/[ids]"), load("context-builder/corrections"), load("sources"), load("sources/[name]"),
  load("entities/[id]"), load("runs"), load("topics"), load("contacts"), load("chat"), load("questions/closed"),
]);

interface Sent { url: string; init: RequestInit }
const sent: Sent[] = [];
let upstream: (url: string) => Response = () => Response.json({ ok: true });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  sent.push({ url: String(input), init });
  return upstream(String(input));
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const UUID = "7d1c6a52-3b0e-4f6a-9a55-0c2f4d2f8e11";
const ask = (fields: Record<string, string> = {}, params: Record<string, string> = {}) =>
  ({ ...makeEvent({ body: new URLSearchParams(fields), params }) }) as any;
const bodyOf = (call: Sent) => JSON.parse(String(call.init.body));

beforeEach(async () => {
  sent.length = 0;
  upstream = () => Response.json({ ok: true });
  await sql`truncate raw_items, extractions, feedback_events, source_quality, source_daily_scores, rss_feeds, newsletter_sender_rules, notification_reads, pipeline_runs, active_topics, chat_conversations cascade`;
});

async function extraction(): Promise<string> {
  const [raw] = await sql`insert into raw_items (run_date, source_type, source_name, raw_content) values ('2026-10-05', 'newsletter', 'Daily', 'x') returning id`;
  const [row] = await sql`insert into extractions (raw_item_id, run_date, extracted_json) values (${raw!.id}, '2026-10-05', '{}'::jsonb) returning id`;
  return row!.id as string;
}
const ratings = (id: string) => sql`select event_type, signal_value from feedback_events where extraction_id = ${id}`;

describe.each([["/[date]", date], ["/[date]/detail/[ids]", detail]])("rate on %s", (_name, page) => {
  test("a rating is stored, a changed mind replaces it, never stacks", async () => {
    const id = await extraction();
    expect(await page.actions.rate(ask({ extraction_id: id, signal: "1" }))).toEqual({ rated: id, eventType: "explicit_plus" });
    expect(await page.actions.rate(ask({ extraction_id: id, signal: "-1" }))).toEqual({ rated: id, eventType: "explicit_minus" });
    expect([...(await ratings(id))]).toEqual([{ event_type: "explicit_minus", signal_value: -1 }]);
  });

  test("a bad id or signal is a 400 and writes nothing", async () => {
    const id = await extraction();
    for (const fields of [{ signal: "1" }, { extraction_id: "nope", signal: "1" }, { extraction_id: id, signal: "2" }, { extraction_id: id }]) {
      expect(await page.actions.rate(ask(fields)), JSON.stringify(fields)).toMatchObject({ status: 400 });
    }
    expect(await ratings(id)).toHaveLength(0);
  });

  test("an extraction that was replaced since is a 404, not a crash", async () => {
    expect(await page.actions.rate(ask({ extraction_id: UUID, signal: "1" }))).toMatchObject({ status: 404, data: { error: "Extraction not found" } });
  });
});

describe("bridge-only actions", () => {
  test("runPipeline posts to the pipeline route and reports it triggered", async () => {
    expect(await date.actions.runPipeline(ask())).toEqual({ triggered: true });
    expect([sent[0]!.url, sent[0]!.init.method]).toEqual(["http://bridge.test/api/pipeline/run", "POST"]);
    upstream = () => Response.json({ error: "Already running" }, { status: 409 });
    expect(await date.actions.runPipeline(ask())).toMatchObject({ status: 409, data: { error: "Already running" } });
  });

  test("deepen sends the parsed ids and the date, and renders the answer as markdown", async () => {
    upstream = () => Response.json({ text: "**Bold** claim" });
    const result = (await detail.actions.deepen(ask({}, { date: "2026-10-05", ids: `${UUID},not-an-id` }))) as any;
    expect(bodyOf(sent[0]!)).toEqual({ ids: [UUID], date: "2026-10-05" });
    expect(result.deepDiveHtml).toContain("<strong>Bold</strong>");
    expect(await detail.actions.deepen(ask({}, { date: "2026-10-05", ids: "junk" }))).toMatchObject({ status: 400 });
    expect(sent).toHaveLength(1);
  });

  test("revertCorrection posts to that correction's revert route and passes the message on", async () => {
    upstream = () => Response.json({ message: "Reverted" });
    expect(await corrections.actions.revertCorrection(ask({ id: UUID }))).toEqual({ message: "Reverted" });
    expect(sent[0]!.url).toBe(`http://bridge.test/api/context/corrections/${UUID}/revert`);
    expect(await corrections.actions.revertCorrection(ask({ id: "../../x" }))).toMatchObject({ status: 400 });
    expect(sent).toHaveLength(1);
  });

  test("watching an entity amends its importance, un-watching sets it back to normal", async () => {
    await entity.actions.watch(ask({ name: "Acme Corp", watched: "true" }));
    expect(bodyOf(sent[0]!)).toMatchObject({ target_kind: "entity", target_key: "Acme Corp", operation: "amend", fields: { importance: "high" }, source: "dashboard" });
    expect(bodyOf(sent[0]!).statement).toContain("is watched");
    await entity.actions.watch(ask({ name: "Acme Corp" }));
    expect(bodyOf(sent[1]!)).toMatchObject({ fields: { importance: "normal" }, statement: "Acme Corp is no longer watched." });
    expect(await entity.actions.watch(ask({}))).toMatchObject({ status: 400 });
    expect(sent).toHaveLength(2);
  });

  test("a contact edit sends only the fields the form carried, blank ones as null", async () => {
    upstream = () => Response.json({ applied: "Saved Anna" });
    const result = await contacts.actions.update(ask({ identifier: "anna@example.test", name: " Anna ", relationship: "", priority: "high" }));
    expect(result).toEqual({ ok: true, message: "Saved Anna" });
    expect(bodyOf(sent[0]!)).toMatchObject({
      target_kind: "contact", target_key: "anna@example.test", operation: "amend", source: "dashboard",
      fields: { name: "Anna", relationship: null, priority: "high" },
      statement: "anna@example.test is Anna.",
    });
    expect(await contacts.actions.update(ask({ identifier: "a@example.test", priority: "urgent" }))).toMatchObject({ status: 400, data: { error: "Invalid priority" } });
    expect(await contacts.actions.update(ask({ name: "x" }))).toMatchObject({ status: 400 });
    expect(sent).toHaveLength(1);
  });

  test("reopen and reprocess hit their own route and keep the row id on a refusal", async () => {
    expect(await closed.actions.reopen(ask({ id: UUID }))).toEqual({ id: UUID, op: "reopen" });
    expect(await closed.actions.reprocess(ask({ id: UUID }))).toEqual({ id: UUID, op: "reprocess" });
    expect(sent.map((s) => s.url)).toEqual([`http://bridge.test/api/questions/${UUID}/reopen`, `http://bridge.test/api/questions/${UUID}/reprocess`]);
    upstream = () => Response.json({ error: "Not closed" }, { status: 409 });
    expect(await closed.actions.reopen(ask({ id: UUID }))).toMatchObject({ status: 409, data: { id: UUID, error: "Not closed" } });
    expect(await closed.actions.reopen(ask({ id: "x" }))).toMatchObject({ status: 400, data: { id: "x" } });
  });
});

describe("sources", () => {
  const row = (name: string) => sql`select is_active, disabled_at::text as disabled_at, disabled_reason from source_quality where source_name = ${name}`;

  test("disabling keeps a reason and the day, enabling clears both; a source with no row gets one", async () => {
    await sources.actions.toggle(ask({ sourceName: "Daily", reason: "Too noisy" }));
    expect([...(await row("Daily"))]).toEqual([{ is_active: false, disabled_at: expect.stringMatching(/^\d{4}-\d\d-\d\d$/), disabled_reason: "Too noisy" }]);
    expect(await sources.actions.toggle(ask({ sourceName: "Daily", isActive: "true", reason: "ignored" }))).toEqual({ ok: true });
    expect([...(await row("Daily"))]).toEqual([{ is_active: true, disabled_at: null, disabled_reason: null }]);
    expect(await sources.actions.toggle(ask({ isActive: "true" }))).toMatchObject({ status: 400 });
  });

  test("the detail page's toggle takes the name from the route, exactly as SvelteKit decoded it", async () => {
    await source.actions.toggle(ask({ reason: "x" }, { name: "100% Club" }));
    await source.actions.toggle(ask({ reason: "x" }, { name: "%41" }));
    expect((await sql`select source_name from source_quality order by source_name`).map((r: any) => r.source_name)).toEqual(["%41", "100% Club"]);
  });

  test("delete removes the source's own rows and nothing else, in every table that names it", async () => {
    for (const name of ["Gone", "Kept"]) {
      await sql`insert into source_quality (source_name) values (${name})`;
      await sql`insert into source_daily_scores (source_name, run_date) values (${name}, '2026-10-05')`;
      await sql`insert into rss_feeds (source_name, url) values (${name}, 'https://example.test/feed')`;
      await sql`insert into newsletter_sender_rules (match_kind, pattern, source_name) values ('domain', ${`${name.toLowerCase()}.example.test`}, ${name})`;
    }
    await sql`insert into raw_items (run_date, source_type, source_name, raw_content) values ('2026-10-05', 'newsletter', 'Gone', 'history')`;

    expect(await source.actions.delete(ask({}, { name: "Gone" }))).toEqual({ ok: true, message: "Deleted Gone.", deleted: "Gone" });
    for (const table of ["source_quality", "source_daily_scores", "rss_feeds", "newsletter_sender_rules"]) {
      const names = (await sql.unsafe(`select source_name from ${table}`)).map((r: any) => r.source_name);
      expect(names, table).toEqual(["Kept"]);
    }
    expect(await sql`select 1 from raw_items where source_name = 'Gone'`).toHaveLength(1);
  });
});

describe("runs and topics", () => {
  test("reviewing a run records the read the Runs badge counts, and twice is fine", async () => {
    expect(await runs.actions.reviewRun(ask({ id: UUID }))).toEqual({ reviewedRun: UUID });
    expect(await runs.actions.reviewRun(ask({ id: UUID }))).toEqual({ reviewedRun: UUID });
    expect((await sql`select notification_key from notification_reads`).map((r: any) => r.notification_key)).toEqual([`run:${UUID}`]);
    expect(await runs.actions.reviewRun(ask({ id: "x" }))).toMatchObject({ status: 400 });
  });

  async function topic(status = "dormant", lastUpdated = "2026-01-01"): Promise<string> {
    const [row] = await sql`insert into active_topics (headline, domain, status, first_seen, last_updated) values ('T', 'tech', ${status}, '2026-01-01', ${lastUpdated}) returning id`;
    return row!.id as string;
  }
  const state = async (id: string) => (await sql`select status, last_updated::text as last_updated from active_topics where id = ${id}`)[0] as any;

  test("setting a status stores it; only reactivating bumps last_updated", async () => {
    const id = await topic();
    expect(await topics.actions.setStatus(ask({ id, status: "resolved" }))).toEqual({ ok: true, id, status: "resolved" });
    expect(await state(id)).toEqual({ status: "resolved", last_updated: "2026-01-01" });
    await topics.actions.setStatus(ask({ id, status: "active" }));
    const after = await state(id);
    expect(after.status).toBe("active");
    expect(after.last_updated).not.toBe("2026-01-01");
  });

  test("an unknown status or a bad id is a 400 and changes nothing", async () => {
    const id = await topic();
    for (const fields of [{ id, status: "deleted" }, { id }, { status: "active" }, { id: "x", status: "active" }]) {
      expect(await topics.actions.setStatus(ask(fields)), JSON.stringify(fields)).toMatchObject({ status: 400 });
    }
    expect((await state(id)).status).toBe("dormant");
  });
});

describe("chat management", () => {
  const conversation = async (title = "Old title") => (await sql`insert into chat_conversations (title) values (${title}) returning id`)[0]!.id as string;

  test("rename trims and caps the title; an empty or unknown one is a 400", async () => {
    const id = await conversation();
    expect(await chat.actions.rename(ask({ id, title: `  ${"x".repeat(250)}  ` }))).toEqual({ ok: true });
    expect((await sql`select title from chat_conversations where id = ${id}`)[0]!.title).toBe("x".repeat(200));
    expect(await chat.actions.rename(ask({ id, title: "   " }))).toMatchObject({ status: 400, data: { error: "A conversation needs a title." } });
    expect(await chat.actions.rename(ask({ id: UUID, title: "t" }))).toMatchObject({ status: 400, data: { error: expect.stringContaining("not found") } });
    expect(await chat.actions.rename(ask({ title: "t" }))).toMatchObject({ status: 400 });
  });

  test("delete takes the messages with it, and deleting twice is still ok", async () => {
    const id = await conversation();
    await sql`insert into chat_messages (conversation_id, role, content) values (${id}, 'user', 'hi')`;
    expect(await chat.actions.delete(ask({ id }))).toEqual({ ok: true, deletedId: id });
    expect(await sql`select 1 from chat_messages`).toHaveLength(0);
    expect(await chat.actions.delete(ask({ id }))).toEqual({ ok: true, deletedId: id });
    expect(await chat.actions.delete(ask({}))).toMatchObject({ status: 400 });
  });
});
