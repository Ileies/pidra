// context-builder/output/db-writer.ts against real SQL: the two seed writers are re-runnable
// (seed twice, no duplicates) and never undo a correction. Nothing is mocked: the writers make no model call.
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { seedContacts, seedRuleNotes } = await import("../context-builder/output/db-writer");

beforeEach(async () => {
  await database.sql`truncate contacts, notes cascade`;
});

const profile = (email: string, over: Record<string, unknown> = {}) => ({
  email, name: "Anna Example", emailCount: 12, categories: ["work"], importance: "high" as const, entities: [], lastSeen: "2026-09-01", actionCount: 3, ...over,
});
const note = (id: string, entities: string[] = []) => ({ id, title: "", labels: [], category: "rules", summary: "", entities, type: "note", importance: "high", rawText: "" });

const contactRows = async () =>
  (await database.sql`select identifier, name, priority, first_seen::text as first_seen, email_count, categories, action_count, updated_at from contacts order by identifier`) as Record<string, any>[];

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
