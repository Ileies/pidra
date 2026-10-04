import { beforeEach, describe, expect, test } from "bun:test";
import * as db from "../src/lib/offline/db.js";
import * as outbox from "../src/lib/offline/outbox.js";
import type { Intent } from "../src/lib/offline/intents.js";
import { ids, intent, note, ok, queue, resetDb, status, stubFetch } from "./offline-helpers.js";
import { invalidated } from "./mocks/app-navigation.js";
import type { NoteRow } from "../src/lib/notes/api.js";

beforeEach(async () => {
  await resetDb();
  invalidated.length = 0;
});

/** `enqueue` starts its flush behind the caller; this waits for it and whatever it left queued. */
const settle = () => outbox.flush();

describe("writes", () => {
  test("createNote shows the note at once, then delivers it with the same client id", async () => {
    const calls = stubFetch(() => ok());
    await outbox.createNote({ content: "remember this", scope: "personal" });
    const [created] = await db.getAll<NoteRow>("notes");
    expect(created).toMatchObject({ content: "remember this", scope: "personal", created_by: "user" });
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ id: created.id, content: "remember this", scope: "personal", expires_at: null });
    expect(await outbox.pending()).toEqual([]);
  });

  test("while the server is unreachable the write and its optimistic effect both stay", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await outbox.createNote({ content: "offline note" });
    await settle();
    const pending = await outbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "note.create", attempts: 1, lastError: "network down" });
    expect(await db.getAll("notes")).toHaveLength(1);
  });

  test("intents queued offline flush in the order they were made once the server answers", async () => {
    let up = false;
    const calls = stubFetch(() => {
      if (!up) throw new TypeError("network down");
      return ok();
    });
    await db.put("notes", note("n1"));
    await outbox.updateNote("n1", { content: "one" });
    await outbox.updateNote("n1", { content: "two" });
    await outbox.deleteNote("n1");
    await settle();
    expect(await outbox.pending()).toHaveLength(3);
    const attemptsBefore = calls.length;

    up = true;
    await outbox.flush();
    expect(calls.slice(attemptsBefore).map((c) => `${c.method} ${c.body ? JSON.stringify((c.body as { content?: string }).content) : ""}`)).toEqual([
      'PATCH "one"', 'PATCH "two"', "DELETE ",
    ]);
    expect(await outbox.pending()).toEqual([]);
  });

  test("updateNote records the updated_at the edit was made against", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await db.put("notes", note("n1", { updated_at: "2026-10-02T09:00:00.000Z" }));
    await outbox.updateNote("n1", { content: "x" });
    expect((await outbox.pending())[0].payload).toMatchObject({ id: "n1", baseUpdatedAt: "2026-10-02T09:00:00.000Z" });
  });

  test("updateNote on a note the mirror lacks records a null base", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await outbox.updateNote("ghost", { content: "x" });
    expect((await outbox.pending())[0].payload).toMatchObject({ baseUpdatedAt: null });
  });

  test("restoreNote undoes a queued delete in the mirror", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await db.put("notes", note("n1"));
    await outbox.deleteNote("n1");
    expect((await db.get<NoteRow>("notes", "n1"))?.deleted_at).not.toBeNull();
    await outbox.restoreNote("n1");
    expect((await db.get<NoteRow>("notes", "n1"))?.deleted_at).toBeNull();
  });

  test("sequence numbers strictly increase across writes", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await outbox.createNote({ content: "a" });
    await outbox.createNote({ content: "b" });
    await outbox.createNote({ content: "c" });
    const seqs = (await outbox.pending()).map((i) => i.seq);
    expect(seqs).toHaveLength(3);
    expect(seqs[0] < seqs[1] && seqs[1] < seqs[2]).toBe(true);
  });

  test("a write invalidates exactly the stores its effect touched", async () => {
    stubFetch(() => ok());
    await outbox.createNote({ content: "x" });
    expect(invalidated.at(-1)).toEqual(["mirror:notes"]);
    await outbox.rate("e1", "1");
    expect(invalidated.at(-1)).toEqual(["mirror:extractions", "mirror:reports"]);
    await settle();
  });
});

describe("rate", () => {
  test("a re-tap replaces the queued rating instead of stacking a second one", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await outbox.rate("e1", "1");
    await outbox.rate("e1", "-1");
    await outbox.rate("e2", "1");
    const pending = await outbox.pending();
    expect(pending.map((i) => i.payload)).toEqual([
      { extractionId: "e1", signal: "-1" },
      { extractionId: "e2", signal: "1" },
    ]);
  });

  test("a re-tap also supersedes a failed rating for the same extraction", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await db.put("failed", intent("rate", { extractionId: "e1", signal: "1" }, 1));
    await outbox.rate("e1", "-1");
    expect(await ids("failed")).toEqual([]);
    expect(await outbox.pending()).toHaveLength(1);
  });

  test("ratings only collapse per extraction, never across kinds", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await queue(intent("note.update", { id: "e1", patch: {}, baseUpdatedAt: null }, 1));
    await outbox.rate("e1", "1");
    expect((await outbox.pending()).map((i) => i.kind)).toEqual(["note.update", "rate"]);
  });
});

describe("flush", () => {
  test("concurrent calls share one run", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls = stubFetch(async () => {
      await gate;
      return ok();
    });
    await queue(intent("note.delete", { id: "a" }, 1));
    const first = outbox.flush();
    const second = outbox.flush();
    expect(second).toBe(first);
    release();
    await first;
    expect(calls).toHaveLength(1);
  });

  test("a finished run does not stick: the next call starts a fresh one", async () => {
    const calls = stubFetch(() => ok());
    await queue(intent("note.delete", { id: "a" }, 1));
    await outbox.flush();
    await queue(intent("note.delete", { id: "b" }, 2));
    await outbox.flush();
    expect(calls).toHaveLength(2);
  });

  test("notifies listeners as the queue changes, until they unsubscribe", async () => {
    stubFetch(() => ok());
    let seen = 0;
    const off = outbox.onChange(() => seen++);
    await queue(intent("note.delete", { id: "a" }, 1));
    await outbox.flush();
    expect(seen).toBe(1);
    off();
    await queue(intent("note.delete", { id: "b" }, 2));
    await outbox.flush();
    expect(seen).toBe(1);
  });

  test("invalidates the notes store when a conflict flag changed the mirror", async () => {
    stubFetch(() => ok({ _conflict: true }));
    await db.put("notes", note("n1"));
    await queue(intent("note.update", { id: "n1", patch: { content: "x" }, baseUpdatedAt: "t0" }, 1));
    await outbox.flush();
    expect(invalidated.at(-1)).toEqual(["mirror:notes"]);
  });
});

describe("failed writes", () => {
  const rejected = (id: string, seq: number): Intent => intent("note.delete", { id }, seq, { lastError: "404: gone" });

  test("a 4xx lands in failed, which is listed in seq order", async () => {
    stubFetch(() => status(422, "bad"));
    await queue(intent("note.delete", { id: "b" }, 2), intent("note.delete", { id: "a" }, 1));
    await outbox.flush();
    expect((await outbox.failed()).map((i) => i.seq)).toEqual([1, 2]);
    expect(await outbox.pending()).toEqual([]);
  });

  test("retryFailed requeues at the tail with a clean slate, re-applies the effect and flushes", async () => {
    const calls = stubFetch(() => ok());
    await db.put("notes", note("n1"));
    await db.put("failed", { ...rejected("n1", 1), attempts: 3 });
    await outbox.retryFailed("intent-1");
    expect((await db.get<NoteRow>("notes", "n1"))?.deleted_at).not.toBeNull();
    await settle();
    expect(calls.map((c) => c.url)).toEqual(["/api/notes/n1"]);
    expect(await ids("failed")).toEqual([]);
    expect(await outbox.pending()).toEqual([]);
  });

  test("retryFailed requeues behind everything already pending", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    await outbox.deleteNote("other");
    await db.put("failed", rejected("n1", 1));
    await outbox.retryFailed("intent-1");
    await settle();
    const pending = await outbox.pending();
    expect(pending.map((i) => i.payload)).toEqual([{ id: "other" }, { id: "n1" }]);
    expect(pending[1].seq).toBeGreaterThan(pending[0].seq);
  });

  test("retryFailed on an id that is not failed does nothing", async () => {
    const calls = stubFetch(() => ok());
    await outbox.retryFailed("nope");
    expect(calls).toHaveLength(0);
    expect(await outbox.pending()).toEqual([]);
  });

  test("discardFailed drops it and tells listeners", async () => {
    await db.put("failed", rejected("n1", 1));
    let seen = 0;
    const off = outbox.onChange(() => seen++);
    await outbox.discardFailed("intent-1");
    off();
    expect(await ids("failed")).toEqual([]);
    expect(seen).toBe(1);
  });
});
