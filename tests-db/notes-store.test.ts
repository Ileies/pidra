// src/notes/store.ts against real SQL: the mutable layer's history, soft delete, the Keep seeding
// rules and the trash purge. Each test starts from empty `notes` / `note_revisions`.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const store = await import("../src/notes/store");

const USER = { by: "user" } as const;
const CHAT = { by: "chat" } as const;
const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  await database.sql`truncate notes cascade`;
});

const revisions = (id: string) => store.noteHistory(id);

describe("createNote", () => {
  test("stores the trimmed content with its provenance and no history", async () => {
    const note = await store.createNote({ content: "  watch the rates  ", scope: "Intel" }, CHAT);
    expect(note).toMatchObject({ content: "watch the rates", scope: "intel", createdBy: "chat", updatedBy: null, deletedAt: null });
    expect(await revisions(note.id)).toHaveLength(0);
  });

  test("rejects an empty note, an unknown scope and a malformed expiry", async () => {
    await expect(store.createNote({ content: "   " }, USER)).rejects.toThrow(/content is required/);
    await expect(store.createNote({ content: "x", scope: "secret" }, USER)).rejects.toThrow(/scope must be one of/);
    await expect(store.createNote({ content: "x", expiresAt: "next week" }, USER)).rejects.toThrow(/YYYY-MM-DD/);
  });

  test("replaying a create with the same id returns the first row", async () => {
    const id = crypto.randomUUID();
    const first = await store.createNote({ id, content: "original" }, USER);
    const again = await store.createNote({ id, content: "different text" }, USER);
    expect(again.id).toBe(first.id);
    expect(again.content).toBe("original");
    expect(await store.listNotes({ include: "all" })).toHaveLength(1);
  });
});

describe("updateNote", () => {
  test("appends the pre-change state and records who edited, never rewriting the author", async () => {
    const note = await store.createNote({ content: "before", scope: "global", expiresAt: "2030-01-01" }, CHAT);
    const edited = await store.updateNote(note.id, { content: "after", scope: "personal", expiresAt: null }, USER);

    expect(edited).toMatchObject({ content: "after", scope: "personal", expiresAt: null, createdBy: "chat", updatedBy: "user" });
    expect(edited.updatedAt).not.toBeNull();
    const [revision, ...rest] = await revisions(note.id);
    expect(rest).toHaveLength(0);
    expect(revision).toMatchObject({ operation: "update", previousContent: "before", previousScope: "global", previousExpiresAt: "2030-01-01", changedBy: "user" });
  });

  test("an edit that changes nothing is not a revision", async () => {
    const note = await store.createNote({ content: "same", scope: "global" }, USER);
    const result = await store.updateNote(note.id, { content: "same", scope: "global" }, CHAT);
    expect(result.updatedAt).toBeNull();
    expect(await revisions(note.id)).toHaveLength(0);
  });

  test("refuses an empty patch, emptied content, a deleted note and an unknown id", async () => {
    const note = await store.createNote({ content: "keep" }, USER);
    await expect(store.updateNote(note.id, {}, USER)).rejects.toThrow(/nothing to update/);
    await expect(store.updateNote(note.id, { content: " " }, USER)).rejects.toThrow(/cannot be emptied/);
    await store.softDeleteNote(note.id, USER);
    await expect(store.updateNote(note.id, { content: "x" }, USER)).rejects.toThrow(/restore it first/);
    await expect(store.updateNote(MISSING, { content: "x" }, USER)).rejects.toMatchObject({ status: 404 });
  });

  test("the history is skipped nowhere: three edits leave three revisions, newest first", async () => {
    const note = await store.createNote({ content: "v0" }, USER);
    for (const content of ["v1", "v2", "v3"]) await store.updateNote(note.id, { content }, USER);
    expect((await revisions(note.id)).map((r) => r.previousContent)).toEqual(["v2", "v1", "v0"]);
  });
});

describe("soft delete and restore", () => {
  test("a delete only sets deleted_at, hides the note and is undone by restore, each with a revision", async () => {
    const note = await store.createNote({ content: "gone soon" }, USER);
    const deleted = await store.softDeleteNote(note.id, CHAT);
    expect(deleted.deletedAt).not.toBeNull();
    expect(await store.listNotes()).toHaveLength(0);
    expect(await store.listNotes({ include: "deleted" })).toHaveLength(1);

    const restored = await store.restoreNote(note.id, USER);
    expect(restored.deletedAt).toBeNull();
    expect(restored.content).toBe("gone soon");
    expect((await revisions(note.id)).map((r) => r.operation).sort()).toEqual(["delete", "restore"]);
  });

  test("deleting a deleted note or restoring a live one is a no-op without a revision", async () => {
    const note = await store.createNote({ content: "x" }, USER);
    await store.restoreNote(note.id, USER);
    expect(await revisions(note.id)).toHaveLength(0);
    await store.softDeleteNote(note.id, USER);
    await store.softDeleteNote(note.id, USER);
    expect(await revisions(note.id)).toHaveLength(1);
  });
});

describe("revertToRevision", () => {
  test("restores the recorded state and is itself a revision, so the history only grows", async () => {
    const note = await store.createNote({ content: "first", scope: "global" }, USER);
    await store.updateNote(note.id, { content: "second", scope: "intel" }, USER);
    const [original] = await revisions(note.id);

    const reverted = await store.revertToRevision(original.id, CHAT);
    expect(reverted).toMatchObject({ content: "first", scope: "global", updatedBy: "chat" });
    expect(await revisions(note.id)).toHaveLength(2);
  });

  test("reverting a trashed note brings it back", async () => {
    const note = await store.createNote({ content: "before" }, USER);
    await store.updateNote(note.id, { content: "after" }, USER);
    const [edit] = await revisions(note.id);
    await store.softDeleteNote(note.id, USER);

    const reverted = await store.revertToRevision(edit.id, USER);
    expect(reverted).toMatchObject({ content: "before", deletedAt: null });
  });

  test("an unknown revision is a 404", async () => {
    await expect(store.revertToRevision(MISSING, USER)).rejects.toMatchObject({ status: 404 });
  });
});

describe("listNotes", () => {
  test("filters by scope, text, author and expiry, and sorts", async () => {
    const a = await store.createNote({ content: "Alpha rates", scope: "intel", expiresAt: "2030-01-01" }, USER);
    const b = await store.createNote({ content: "Beta weather", scope: "personal" }, CHAT);
    const c = await store.createNote({ content: "Gamma rates", scope: "intel" }, USER);

    const ids = async (opts: Parameters<typeof store.listNotes>[0]) => (await store.listNotes(opts)).map((n) => n.id);
    expect(await ids({ scope: "intel", sort: "oldest" })).toEqual([a.id, c.id]);
    expect(await ids({ query: "RATES", sort: "newest" })).toEqual([c.id, a.id]);
    expect(await ids({ createdBy: "chat" })).toEqual([b.id]);
    expect(await ids({ expiresBefore: "2030-12-31" })).toEqual([a.id]);
    expect(await ids({ expiresBefore: "2029-12-31" })).toEqual([]);

    await store.updateNote(a.id, { content: "Alpha rates, revised" }, USER);
    expect((await ids({ sort: "edited" }))[0]).toBe(a.id);
  });

  test("rejects a bad scope, author or date", async () => {
    await expect(store.listNotes({ scope: "nope" })).rejects.toThrow(/scope/);
    await expect(store.listNotes({ createdBy: "robot" })).rejects.toThrow(/created_by/);
    await expect(store.listNotes({ createdSince: "yesterday" })).rejects.toThrow(/created_since/);
  });
});

describe("seedHarvestedNotes", () => {
  test("adds a rule once and ignores empty ones", async () => {
    expect(await store.seedHarvestedNotes([{ key: "k1", content: "Rule one" }, { key: "k2", content: "  " }])).toEqual({ added: 1, refreshed: 0 });
    expect(await store.seedHarvestedNotes([{ key: "k1", content: "Rule one" }])).toEqual({ added: 0, refreshed: 0 });
    const [seeded] = await store.listNotes();
    expect(seeded).toMatchObject({ scope: "personal", createdBy: "harvest", sourceKey: "k1" });
  });

  test("a live untouched row follows the new text and keeps the old one as a revision", async () => {
    await store.seedHarvestedNotes([{ key: "k1", content: "Old text" }]);
    expect(await store.seedHarvestedNotes([{ key: "k1", content: "New text" }])).toEqual({ added: 0, refreshed: 1 });
    const [note] = await store.listNotes();
    expect(note).toMatchObject({ content: "New text", updatedBy: "harvest" });
    expect((await revisions(note.id)).map((r) => [r.changedBy, r.previousContent])).toEqual([["harvest", "Old text"]]);
  });

  test("a rule the user rewrote or trashed is never overwritten or resurrected", async () => {
    await store.seedHarvestedNotes([{ key: "edited", content: "A" }, { key: "trashed", content: "B" }]);
    const [edited] = await store.listNotes({ query: "A" });
    const [trashed] = await store.listNotes({ query: "B" });
    await store.updateNote(edited.id, { content: "A, mine" }, USER);
    await store.softDeleteNote(trashed.id, USER);

    expect(await store.seedHarvestedNotes([{ key: "edited", content: "A from Keep" }, { key: "trashed", content: "B from Keep" }])).toEqual({ added: 0, refreshed: 0 });
    expect((await store.getNote(edited.id))?.content).toBe("A, mine");
    expect((await store.getNote(trashed.id))?.deletedAt).not.toBeNull();
    expect(await store.listNotes({ include: "all" })).toHaveLength(2);
  });
});

describe("pruneDeletedNotes", () => {
  test("purges ordinary notes 30 days after deletion, with their history, and spares Keep rules", async () => {
    const old = await store.createNote({ content: "old trash" }, USER);
    const recent = await store.createNote({ content: "recent trash" }, USER);
    const live = await store.createNote({ content: "alive" }, USER);
    await store.seedHarvestedNotes([{ key: "k1", content: "Keep rule" }]);
    const [rule] = await store.listNotes({ query: "Keep rule" });
    for (const id of [old.id, recent.id, rule.id]) await store.softDeleteNote(id, USER);
    await database.sql`update notes set deleted_at = now() - interval '31 days' where id in (${old.id}, ${rule.id})`;
    await database.sql`update notes set deleted_at = now() - interval '29 days' where id = ${recent.id}`;

    await store.pruneDeletedNotes();

    const left = (await store.listNotes({ include: "all" })).map((n) => n.id).sort();
    expect(left).toEqual([live.id, recent.id, rule.id].sort());
    const [{ n }] = await database.sql`select count(*)::int as n from note_revisions where note_id = ${old.id}`;
    expect(n).toBe(0);
  });
});

describe("formatNoteLine", () => {
  test("names scope, expiry, deletion and who wrote and edited it", async () => {
    const note = await store.createNote({ content: "line", scope: "contact", expiresAt: "2031-02-03" }, CHAT);
    const edited = await store.updateNote(note.id, { content: "line 2" }, USER);
    expect(store.formatNoteLine(edited)).toBe(`${note.id} [contact | expires 2031-02-03 | by chat, edited by user]\nline 2`);
  });
});
