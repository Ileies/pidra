// context-builder/output/db-writer.ts against real SQL: the three seed writers are re-runnable
// (seed twice, no duplicates), never undo a correction or the daily pipeline's live counts, and
// keep model noise out of the graph. Nothing is mocked: the writers make no model call.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { seedContacts, seedEntities, seedRuleNotes } = await import("../context-builder/output/db-writer");

beforeEach(async () => {
  await database.sql`truncate contacts, entities, notes cascade`;
});

const profile = (email: string, over: Record<string, unknown> = {}) => ({
  email, name: "Anna Example", emailCount: 12, categories: ["work"], importance: "high" as const, entities: [], lastSeen: "2026-09-01", actionCount: 3, ...over,
});
const mail = (messageId: string, entities: string[], date = "2026-09-10T08:00:00Z") => ({
  messageId, from: "anna@example.com", fromName: "Anna", date, category: "work", importance: "high", summary: "s", actionRequired: null, entities, sentiment: "neutral",
});
const note = (id: string, entities: string[] = []) => ({ id, title: "", labels: [], category: "rules", summary: "", entities, type: "note", importance: "high", rawText: "" });

const contactRows = async () =>
  (await database.sql`select identifier, name, priority, first_seen::text as first_seen, email_count, categories, action_count, updated_at from contacts order by identifier`) as Record<string, any>[];
const entityRows = async () =>
  (await database.sql`select name, mention_count, first_seen::text as first_seen, last_mentioned::text as last_mentioned, status, importance from entities order by name`) as Record<string, any>[];
const mentionRows = async () =>
  (await database.sql`select e.name, m.source_kind, m.source_ref, m.mention_date::text as mention_date from entity_mentions m join entities e on e.id = m.entity_id order by e.name, m.source_ref`) as Record<string, any>[];

describe("seedContacts", () => {
  test("seeds high and medium contacts with their corpus metrics and skips low ones and non-addresses", async () => {
    await seedContacts([
      profile("high@example.com"),
      profile("medium@example.com", { importance: "medium", name: "Mia\u0000 Mid" }),
      profile("low@example.com", { importance: "low" }),
      profile("Anna <anna@example.com>"),
      profile("no-dot@example"),
      profile("two words@example.com"),
    ]);

    const rows = await contactRows();
    expect(rows.map((r) => r.identifier)).toEqual(["high@example.com", "medium@example.com"]);
    expect(rows[0]).toMatchObject({ name: "Anna Example", priority: "high", first_seen: "2026-09-01", email_count: 12, categories: ["work"], action_count: 3 });
    expect(rows[1]).toMatchObject({ name: "Mia Mid", priority: "medium" });
  });

  test("nothing to seed writes nothing", async () => {
    await seedContacts([]);
    await seedContacts([profile("low@example.com", { importance: "low" })]);
    expect(await contactRows()).toEqual([]);
  });

  test("seeding twice leaves one row each; a re-seed refreshes the name and priority but never the corpus metrics", async () => {
    await seedContacts([profile("anna@example.com")]);
    await database.sql`update contacts set email_count = 40, categories = '{live}', action_count = 9, first_seen = '2026-01-01'`;
    const before = (await contactRows())[0]!;

    await seedContacts([profile("anna@example.com", { name: "Anna Renamed", importance: "medium", emailCount: 99, categories: ["other"], actionCount: 0, lastSeen: "2026-10-01" })]);

    const rows = await contactRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Anna Renamed", priority: "medium", email_count: 40, categories: ["live"], action_count: 9, first_seen: "2026-01-01" });
    expect(rows[0]!.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  test("a locked (user-corrected) contact is never touched by a re-seed", async () => {
    await seedContacts([profile("anna@example.com")]);
    await database.sql`update contacts set locked = true, name = 'Corrected', priority = 'critical'`;
    await seedContacts([profile("anna@example.com", { name: "Model name", importance: "medium" })]);
    expect((await contactRows())[0]).toMatchObject({ name: "Corrected", priority: "critical" });
  });

  test("a full build is written in batches: 1200 contacts, all of them, and again without duplicates", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => profile(`c${i}@example.com`));
    await seedContacts(all);
    await seedContacts(all);
    expect(await database.sql`select count(*)::int as n from contacts`).toEqual([{ n: 1200 }]);
  });
});

describe("seedEntities", () => {
  test("counts mentions across emails and Keep notes, once per item, merging spellings case-insensitively", async () => {
    await seedEntities(
      [mail("m1", ["Acme Corp", "acme corp", "Bravo Labs"]), mail("m2", ["ACME  CORP"], "2026-09-20T08:00:00Z"), mail("m3", ["Acme Corp"], "2026-09-05T08:00:00Z")],
      [note("n1", ["Acme Corp", "Acme Corp"]), note("n2", ["Charlie Works"])],
    );

    const rows = await entityRows();
    expect(rows.map((r) => [r.name, r.mention_count])).toEqual([["Acme Corp", 4], ["Bravo Labs", 1], ["Charlie Works", 1]]);
    expect(rows[0]).toMatchObject({ first_seen: "2026-09-05", last_mentioned: "2026-09-20", status: "active", importance: "normal" });
  });

  test("a note-only entity has no last-mentioned date and first-seen falls back to today", async () => {
    await seedEntities([], [note("n1", ["Charlie Works"])]);
    const [row] = await entityRows();
    const [{ today }] = await database.sql`select (now() at time zone 'utc')::date::text as today`;
    expect(row).toMatchObject({ last_mentioned: null, first_seen: today });
  });

  test("keeps one provenance row per contributing item, with the mail's date and none for a note", async () => {
    await seedEntities([mail("m1", ["Acme Corp", "Acme Corp"]), mail("m2", ["Acme Corp"], "2026-09-20T08:00:00Z")], [note("n1", ["Acme Corp"])]);
    expect(await mentionRows()).toEqual([
      { name: "Acme Corp", source_kind: "context_builder", source_ref: "email:m1", mention_date: "2026-09-10" },
      { name: "Acme Corp", source_kind: "context_builder", source_ref: "email:m2", mention_date: "2026-09-20" },
      { name: "Acme Corp", source_kind: "context_builder", source_ref: "keep:n1", mention_date: null },
    ]);
  });

  test("leaves model noise out: short and over-long names, bare numbers, phone numbers and dates, but not names that merely start like a month", async () => {
    await seedEntities(
      [mail("m1", [
        "AI", "x".repeat(81), "1234", "+41 79 123 45 67", "12.5 %", "2026-09-10", "10.09.2026", "10. September 2026", "September 10, 2026", "Sep 2026",
        "Martin Keller", "Marriott Group", "Jannik Sinner", "May Day Project", "Apricot Labs", "  Real Name  ", "Nul\u0000l Byte Inc",
      ])],
      [],
    );
    expect((await entityRows()).map((r) => r.name)).toEqual(["Apricot Labs", "Jannik Sinner", "Marriott Group", "Martin Keller", "May Day Project", "Null Byte Inc", "Real Name"]);
  });

  test("seeding twice adds no entity and no mention; counts are not overwritten, not even after the daily pipeline raised them", async () => {
    const mails = [mail("m1", ["Acme Corp"]), mail("m2", ["Acme Corp"])];
    await seedEntities(mails, []);
    await database.sql`update entities set mention_count = 9, importance = 'high', status = 'dormant', last_mentioned = '2026-10-01'`;
    await seedEntities(mails, [note("n1", ["Acme Corp"])]);

    expect(await entityRows()).toEqual([expect.objectContaining({ name: "Acme Corp", mention_count: 9, importance: "high", status: "dormant", last_mentioned: "2026-10-01" })]);
    expect((await mentionRows()).map((m) => m.source_ref)).toEqual(["email:m1", "email:m2"]);
  });

  test("an entity the daily pipeline created first gets no corpus provenance, a new one beside it does", async () => {
    await database.sql`insert into entities (name, mention_count) values ('Acme Corp', 5)`;
    await seedEntities([mail("m1", ["Acme Corp", "Bravo Labs"])], []);
    expect((await mentionRows()).map((m) => m.name)).toEqual(["Bravo Labs"]);
    expect((await entityRows()).find((r) => r.name === "Acme Corp")!.mention_count).toBe(5);
  });

  test("another spelling of a stored entity is not inserted as a second row", async () => {
    await database.sql`insert into entities (name, mention_count) values ('ACME Corp', 5)`;
    await seedEntities([mail("m1", ["Acme  Corp", "Bravo Labs"])], []);
    expect((await entityRows()).map((r) => [r.name, r.mention_count])).toEqual([["ACME Corp", 5], ["Bravo Labs", 1]]);
    expect((await mentionRows()).map((m) => m.name)).toEqual(["Bravo Labs"]);
  });

  test("a full build is written in batches: 1200 entities with their mentions, and again without duplicates", async () => {
    const mails = Array.from({ length: 1200 }, (_, i) => mail(`m${i}`, [`Entity number ${i}`]));
    await seedEntities(mails, []);
    await seedEntities(mails, []);
    expect(await database.sql`select count(*)::int as n from entities`).toEqual([{ n: 1200 }]);
    expect(await database.sql`select count(*)::int as n from entity_mentions`).toEqual([{ n: 1200 }]);
  });

  test("nothing to seed writes nothing", async () => {
    await seedEntities([], []);
    await seedEntities([mail("m1", ["AI", "2026-09-10"])], []);
    expect(await entityRows()).toEqual([]);
  });
});

describe("seedRuleNotes", () => {
  const rule = (id: string, over: Record<string, unknown> = {}) => ({ ...note(id), type: "rule", title: "Invoices", rawText: "Pay within 14 days", ...over });
  const noteRows = async () => (await database.sql`select content, scope, created_by, source_key from notes order by source_key`) as Record<string, any>[];

  test("only important rules become personal notes keyed by the Keep id, titled by the note or else its summary", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    await seedRuleNotes([
      rule("a", { summary: "A summary that is not used" }),
      rule("b", { title: "", summary: "Travel", rawText: "Window seat" }),
      rule("c", { importance: "low" }),
      rule("d", { type: "note" }),
    ]);
    log.mockRestore();

    expect(await noteRows()).toEqual([
      { content: "Invoices: Pay within 14 days", scope: "personal", created_by: "harvest", source_key: "keep_rule_a" },
      { content: "Travel: Window seat", scope: "personal", created_by: "harvest", source_key: "keep_rule_b" },
    ]);
  });

  test("seeding twice adds nothing, and an edited or deleted rule is not overwritten or revived", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    await seedRuleNotes([rule("a"), rule("b")]);
    await database.sql`update notes set content = 'My own wording', updated_by = 'user' where source_key = 'keep_rule_a'`;
    await database.sql`update notes set deleted_at = now() where source_key = 'keep_rule_b'`;
    await seedRuleNotes([rule("a", { rawText: "Changed in Keep" }), rule("b", { rawText: "Changed in Keep" })]);
    log.mockRestore();

    const rows = await database.sql`select content, deleted_at is not null as deleted from notes order by source_key`;
    expect(rows).toEqual([{ content: "My own wording", deleted: false }, { content: "Invoices: Pay within 14 days", deleted: true }]);
  });

  test("no rules writes nothing", async () => {
    await seedRuleNotes([note("x"), rule("y", { importance: "low" })]);
    expect(await noteRows()).toEqual([]);
  });
});
