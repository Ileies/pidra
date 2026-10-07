// src/notes/select.ts against real SQL: which scopes each step reads, and that deleted and expired
// notes never come back. Each test starts from empty `notes`.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const store = await import("../src/notes/store");
const { selectNotes } = await import("../src/notes/select");

const USER = { by: "user" } as const;
const TODAY = "2030-06-15";

beforeEach(async () => {
  await database.sql`truncate notes cascade`;
});

const contents = async (step: Parameters<typeof selectNotes>[0]) => (await selectNotes(step, TODAY)).map((n) => n.content);

describe("selectNotes", () => {
  test("each step reads only its scopes", async () => {
    for (const scope of ["global", "intel", "personal", "contact", "search"]) {
      await store.createNote({ content: scope, scope }, USER);
    }

    expect((await contents("classify")).sort()).toEqual(["contact", "global", "personal"]);
    expect((await contents("section1")).sort()).toEqual(["global", "intel"]);
    expect((await contents("section2")).sort()).toEqual(["global", "personal"]);
    expect(await contents("news")).toEqual(["intel"]);
    expect(await contents("actions")).toEqual(["personal"]);
    expect((await contents("reconcile")).sort()).toEqual(["contact", "personal"]);
    expect(await contents("search")).toEqual(["search"]);
  });

  test("skips deleted notes and notes expired before the run date, keeps one expiring that day", async () => {
    const gone = await store.createNote({ content: "deleted", scope: "personal" }, USER);
    await store.softDeleteNote(gone.id, USER);
    await store.createNote({ content: "expired", scope: "personal", expiresAt: "2030-06-14" }, USER);
    await store.createNote({ content: "last day", scope: "personal", expiresAt: TODAY }, USER);
    await store.createNote({ content: "open ended", scope: "personal" }, USER);

    for (const step of ["classify", "section2", "actions", "reconcile"] as const) {
      expect((await contents(step)).sort()).toEqual(["last day", "open ended"]);
    }
  });

  test("a note is live from active_from and not before", async () => {
    await database.sql`insert into notes (content, scope, active_from) values ('later', 'personal', '2030-06-16'), ('today', 'personal', ${TODAY}), ('earlier', 'personal', '2030-01-01')`;
    expect((await contents("section2")).sort()).toEqual(["earlier", "today"]);
  });

  test("steps limit a note to the named steps; empty means every step its scope reaches", async () => {
    await database.sql`insert into notes (content, scope, steps) values ('only classify', 'personal', '{classify}'), ('everywhere', 'personal', '{}')`;
    expect((await contents("classify")).sort()).toEqual(["everywhere", "only classify"]);
    expect(await contents("section2")).toEqual(["everywhere"]);
    expect(await contents("actions")).toEqual(["everywhere"]);
  });

  test("applies_to loads a note only for a matching item, and never for a stage without one", async () => {
    await database.sql`insert into notes (content, scope, applies_to) values
      ('netcup pays itself', 'personal', '{"senders": ["netcup"]}'),
      ('invoice from netcup', 'personal', '{"senders": ["netcup"], "keywords": ["invoice"]}'),
      ('plain', 'personal', null)`;
    const names = async (item?: Parameters<typeof selectNotes>[2]) =>
      (await selectNotes("classify", TODAY, item)).map((n) => n.content).sort();

    expect(await names()).toEqual(["plain"]);
    expect(await names({ sender: "billing@Netcup.de", text: "Your Invoice" })).toEqual(["invoice from netcup", "netcup pays itself", "plain"]);
    expect(await names({ sender: "billing@netcup.de", text: "Welcome" })).toEqual(["netcup pays itself", "plain"]);
    expect(await names({ sender: "other@example.com", text: "invoice" })).toEqual(["plain"]);
    expect(await names({ sender: null, text: "netcup invoice" })).toEqual(["plain"]);
  });

  test("entities match the item text or its entity names", async () => {
    await database.sql`insert into notes (content, scope, applies_to) values ('about acme', 'personal', '{"entities": ["Acme"]}')`;
    expect(await selectNotes("classify", TODAY, { text: "unrelated", entities: ["Acme Corp"] })).toHaveLength(1);
    expect(await selectNotes("classify", TODAY, { text: "news from ACME today" })).toHaveLength(1);
    expect(await selectNotes("classify", TODAY, { text: "nothing" })).toHaveLength(0);
  });

  test("returns oldest first", async () => {
    await store.createNote({ content: "first", scope: "intel" }, USER);
    await store.createNote({ content: "second", scope: "intel" }, USER);
    expect(await contents("news")).toEqual(["first", "second"]);
  });
});
