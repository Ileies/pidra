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

  test("returns oldest first", async () => {
    await store.createNote({ content: "first", scope: "intel" }, USER);
    await store.createNote({ content: "second", scope: "intel" }, USER);
    expect(await contents("news")).toEqual(["first", "second"]);
  });
});
