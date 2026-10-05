// The constraints the schema declares (CHECKs and unique keys), proven against real SQL: a bad row
// is rejected by the database itself, and the rows the code relies on as upsert keys are really unique.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();

// A Bun SQL query is a lazy thenable: `rejects` hangs on it unless it runs inside a real promise.
const attempt = (run: () => PromiseLike<unknown>) => (async () => { await run(); })();

beforeEach(async () => {
  await database.sql`truncate user_settings, contacts, entities, source_daily_scores, newsletter_sender_rules, context_builder_indexed_items cascade`;
});

describe("user_settings", () => {
  test("holds one row only", async () => {
    await database.sql`insert into user_settings (id) values (1)`;
    await expect(attempt(() => database.sql`insert into user_settings (id) values (2)`)).rejects.toThrow(/user_settings_singleton/);
    await expect(attempt(() => database.sql`insert into user_settings (id) values (1)`)).rejects.toThrow(/user_settings_pkey/);
  });

  test("takes two-letter lowercase language codes and nothing else", async () => {
    await database.sql`insert into user_settings (id, ui_language, content_language) values (1, 'de', 'fr')`;
    for (const bad of ["EN", "eng", "e", "", "e1", "en ", "de-CH"]) {
      await expect(attempt(() => database.sql`update user_settings set content_language = ${bad}`)).rejects.toThrow(/user_settings_content_language_code/);
      await expect(attempt(() => database.sql`update user_settings set ui_language = ${bad}`)).rejects.toThrow(/user_settings_ui_language_code/);
    }
    expect(await database.sql`select ui_language, content_language from user_settings`).toEqual([{ ui_language: "de", content_language: "fr" }]);
  });

  test("the defaults are English", async () => {
    await database.sql`insert into user_settings (id) values (1)`;
    expect(await database.sql`select ui_language, content_language from user_settings`).toEqual([{ ui_language: "en", content_language: "en" }]);
  });
});

describe("contacts", () => {
  test("an identifier has to look like an email address", async () => {
    for (const bad of ["", "anna", "anna@example", "anna.example.com", "anna@", "example.com@anna"]) {
      await expect(attempt(() => database.sql`insert into contacts (identifier) values (${bad})`)).rejects.toThrow(/contacts_identifier_email_like/);
    }
    await database.sql`insert into contacts (identifier) values ('anna@example.com')`;
    expect(await database.sql`select count(*)::int as n from contacts`).toEqual([{ n: 1 }]);
  });

  test("an identifier is unique", async () => {
    await database.sql`insert into contacts (identifier) values ('anna@example.com')`;
    await expect(attempt(() => database.sql`insert into contacts (identifier) values ('anna@example.com')`)).rejects.toThrow(/contacts_identifier_key/);
  });
});

describe("unique keys the upserts rely on", () => {
  test("an entity name", async () => {
    await database.sql`insert into entities (name) values ('Acme')`;
    await expect(attempt(() => database.sql`insert into entities (name) values ('Acme')`)).rejects.toThrow(/entities_name_key/);
  });

  test("one mention per entity and source item", async () => {
    const [{ id }] = await database.sql`insert into entities (name) values ('Acme') returning id`;
    await database.sql`insert into entity_mentions (entity_id, source_kind, source_ref) values (${id}, 'newsletter', 'r1')`;
    await database.sql`insert into entity_mentions (entity_id, source_kind, source_ref) values (${id}, 'newsletter', 'r2'), (${id}, 'context_builder', 'r1')`;
    await expect(attempt(() => database.sql`insert into entity_mentions (entity_id, source_kind, source_ref) values (${id}, 'newsletter', 'r1')`)).rejects.toThrow(/entity_mentions_entity_source/);
  });

  test("one appearance per entity and report date", async () => {
    const [{ id }] = await database.sql`insert into entities (name) values ('Acme') returning id`;
    await database.sql`insert into entity_appearances (entity_id, report_date) values (${id}, '2026-10-05')`;
    await expect(attempt(() => database.sql`insert into entity_appearances (entity_id, report_date) values (${id}, '2026-10-05')`)).rejects.toThrow(/entity_appearances_entity_date/);
  });

  test("one score per source and day", async () => {
    await database.sql`insert into source_daily_scores (source_name, run_date) values ('Daily Digest', '2026-10-05'), ('Daily Digest', '2026-10-06')`;
    await expect(attempt(() => database.sql`insert into source_daily_scores (source_name, run_date) values ('Daily Digest', '2026-10-05')`)).rejects.toThrow(/source_daily_scores_source_date/);
  });

  test("one sender rule per match kind and pattern", async () => {
    await database.sql`insert into newsletter_sender_rules (match_kind, pattern, source_name) values ('domain', 'example.com', 'A'), ('address', 'example.com', 'B')`;
    await expect(attempt(() => database.sql`insert into newsletter_sender_rules (match_kind, pattern, source_name) values ('domain', 'example.com', 'C')`)).rejects.toThrow(/newsletter_sender_rules_match_unique/);
  });

  test("one indexed item per source and item id", async () => {
    await database.sql`insert into context_builder_indexed_items (source, item_id) values ('email', 'm1'), ('keep', 'm1')`;
    await expect(attempt(() => database.sql`insert into context_builder_indexed_items (source, item_id) values ('email', 'm1')`)).rejects.toThrow(/cb_indexed_source_item/);
  });
});
