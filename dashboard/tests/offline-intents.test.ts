import { beforeEach, describe, expect, test } from "bun:test";
import * as db from "../src/lib/offline/db.js";
import {
  applyOptimistic, drain, intentIsFor, intentSummary, reapplyPending, sortedOutbox, storesOf, type Intent,
} from "../src/lib/offline/intents.js";
import { ids, intent, note, ok, queue, resetDb, status, stubFetch } from "./offline-helpers.js";
import type { NoteRow } from "../src/lib/notes/api.js";

beforeEach(resetDb);

const asRow = (value: unknown) => value as db.Keyed;

describe("applyOptimistic", () => {
  test("note.create writes a user note with the client id", async () => {
    await applyOptimistic(intent("note.create", { id: "n1", content: "hello", scope: "global", expiresAt: null }, 1));
    expect(await db.get<NoteRow>("notes", "n1")).toMatchObject({ content: "hello", scope: "global", created_by: "user", deleted_at: null });
  });

  test("every kind is idempotent: applying twice equals applying once", async () => {
    await db.put("notes", note("n1"));
    await db.put("reports", asRow({ id: "2026-10-04", ratings: {} }));
    await db.put("extractions", asRow({ id: "e1", rating: null }));
    const intents = [
      intent("note.update", { id: "n1", patch: { content: "edited" }, baseUpdatedAt: null }, 1),
      intent("note.delete", { id: "n1" }, 2),
      intent("note.restore", { id: "n1" }, 3),
      intent("rate", { extractionId: "e1", signal: "1" }, 4),
    ];
    for (const i of intents) await applyOptimistic(i);
    const once = JSON.stringify([await db.getAll("notes"), await db.getAll("reports"), await db.getAll("extractions")]);
    for (const i of intents) await applyOptimistic(i);
    expect(JSON.stringify([await db.getAll("notes"), await db.getAll("reports"), await db.getAll("extractions")])).toBe(once);
  });

  test("note.update leaves omitted fields alone and clears expiresAt when it is present but null", async () => {
    await db.put("notes", note("n1", { content: "keep", scope: "personal", expires_at: "2026-12-01T00:00:00.000Z" }));
    await applyOptimistic(intent("note.update", { id: "n1", patch: { expiresAt: null }, baseUpdatedAt: null }, 1));
    expect(await db.get<NoteRow>("notes", "n1")).toMatchObject({ content: "keep", scope: "personal", expires_at: null, updated_by: "user" });

    await applyOptimistic(intent("note.update", { id: "n1", patch: { scope: "global" }, baseUpdatedAt: null }, 2));
    expect(await db.get<NoteRow>("notes", "n1")).toMatchObject({ content: "keep", scope: "global", expires_at: null });
  });

  test("note.update, delete and restore on a row that is not there do nothing", async () => {
    for (const i of [
      intent("note.update", { id: "gone", patch: { content: "x" }, baseUpdatedAt: null }, 1),
      intent("note.delete", { id: "gone" }, 2),
      intent("note.restore", { id: "gone" }, 3),
    ]) await applyOptimistic(i);
    expect(await ids("notes")).toEqual([]);
  });

  test("note.delete marks the row deleted and note.restore clears it", async () => {
    await db.put("notes", note("n1"));
    await applyOptimistic(intent("note.delete", { id: "n1" }, 1));
    expect((await db.get<NoteRow>("notes", "n1"))?.deleted_at).toBe("2026-10-04T10:00:01.000Z");
    await applyOptimistic(intent("note.restore", { id: "n1" }, 2));
    expect((await db.get<NoteRow>("notes", "n1"))?.deleted_at).toBeNull();
  });

  test("rate sets the rating in every report that cites the extraction and in the extraction", async () => {
    await db.put("reports", asRow({ id: "d1", ratings: { other: "explicit_plus" } }));
    await db.put("reports", asRow({ id: "d2", ratings: {} }));
    await db.put("extractions", asRow({ id: "e1", rating: null }));
    await applyOptimistic(intent("rate", { extractionId: "e1", signal: "-1" }, 1));
    expect(await db.get("reports", "d1")).toMatchObject({ ratings: { other: "explicit_plus", e1: "explicit_minus" } });
    expect(await db.get("reports", "d2")).toMatchObject({ ratings: { e1: "explicit_minus" } });
    expect(await db.get("extractions", "e1")).toMatchObject({ rating: "explicit_minus" });
  });

  test("report.read stamps the report once and keeps the earliest time", async () => {
    await db.put("reports", asRow({ id: "d1", ratings: {}, readAt: null }));
    await applyOptimistic(intent("report.read", { date: "d1" }, 1));
    await applyOptimistic(intent("report.read", { date: "d1" }, 5));
    expect(await db.get("reports", "d1")).toMatchObject({ readAt: "2026-10-04T10:00:01.000Z" });
    expect(intentIsFor(intent("report.read", { date: "d1" }, 1), "rate", "d1")).toBe(false);
  });

  test("report.read for a report the mirror does not hold changes nothing", async () => {
    await applyOptimistic(intent("report.read", { date: "d9" }, 1));
    expect(await ids("reports")).toEqual([]);
  });

  test("rate for an extraction the mirror does not hold only touches the reports", async () => {
    await db.put("reports", asRow({ id: "d1", ratings: {} }));
    await applyOptimistic(intent("rate", { extractionId: "e9", signal: "1" }, 1));
    expect(await db.get("reports", "d1")).toMatchObject({ ratings: { e9: "explicit_plus" } });
    expect(await ids("extractions")).toEqual([]);
  });
});

describe("reapplyPending", () => {
  test("replays queued intents in seq order on top of fresh server rows", async () => {
    await db.put("notes", note("n1", { content: "server" }));
    await queue(
      intent("note.update", { id: "n1", patch: { content: "second" }, baseUpdatedAt: null }, 2),
      intent("note.update", { id: "n1", patch: { content: "first" }, baseUpdatedAt: null }, 1),
    );
    await reapplyPending();
    expect((await db.get<NoteRow>("notes", "n1"))?.content).toBe("second");
  });

  test("does nothing with an empty queue and ignores the failed list", async () => {
    await db.put("notes", note("n1", { content: "server" }));
    await db.put("failed", intent("note.update", { id: "n1", patch: { content: "failed" }, baseUpdatedAt: null }, 1));
    await reapplyPending();
    expect((await db.get<NoteRow>("notes", "n1"))?.content).toBe("server");
  });
});

describe("helpers", () => {
  test("storesOf names exactly the stores an intent's effect writes", () => {
    expect(storesOf("rate")).toEqual(["reports", "extractions"]);
    expect(storesOf("note.create")).toEqual(["notes"]);
  });

  test("intentIsFor matches the row family and id, not the intent kind alone", () => {
    const edit = intent("note.update", { id: "n1", patch: {}, baseUpdatedAt: null }, 1);
    const rating = intent("rate", { extractionId: "e1", signal: "1" }, 2);
    expect(intentIsFor(edit, "note", "n1")).toBe(true);
    expect(intentIsFor(edit, "note", "n2")).toBe(false);
    expect(intentIsFor(edit, "rate", "n1")).toBe(false);
    expect(intentIsFor(rating, "rate", "e1")).toBe(true);
    expect(intentIsFor(rating, "note", "e1")).toBe(false);
  });

  test("intentSummary shows note text for a create and a short id otherwise", () => {
    expect(intentSummary(intent("note.create", { id: "n1", content: "x".repeat(80) }, 1))).toBe("x".repeat(60));
    expect(intentSummary(intent("rate", { extractionId: "abcdef123456", signal: "1" }, 2))).toBe("extraction abcdef12…");
    expect(intentSummary(intent("note.delete", { id: "abcdef123456" }, 3))).toBe("abcdef12…");
  });

  test("sortedOutbox orders by seq, not insertion", async () => {
    await queue(intent("note.delete", { id: "b" }, 3), intent("note.delete", { id: "a" }, 1), intent("note.delete", { id: "c" }, 2));
    expect((await sortedOutbox()).map((i) => i.seq)).toEqual([1, 2, 3]);
  });
});

describe("drain", () => {
  const send = (input: string, init?: RequestInit) => fetch(input, init);

  test("sends each kind to its endpoint in seq order and empties the queue", async () => {
    const calls = stubFetch(() => ok());
    await queue(
      intent("rate", { extractionId: "e1", signal: "-1" }, 5),
      intent("note.restore", { id: "n1" }, 4),
      intent("note.delete", { id: "n1" }, 3),
      intent("note.update", { id: "n1", patch: { content: "x" }, baseUpdatedAt: "t0" }, 2),
      intent("note.create", { id: "n1", content: "hi", scope: "global", expiresAt: null }, 1),
    );
    const result = await drain(send);
    expect(result).toEqual({ complete: true, delivered: 5, changed: [] });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/notes", "PATCH /api/notes/n1", "DELETE /api/notes/n1", "POST /api/notes/n1/restore", "POST /api/feedback",
    ]);
    expect(calls[0].body).toEqual({ id: "n1", content: "hi", scope: "global", expires_at: null });
    expect(calls[1].body).toEqual({ content: "x", base_updated_at: "t0" });
    expect(calls[4].body).toEqual({ extraction_id: "e1", signal: "-1" });
    expect(await ids("outbox")).toEqual([]);
  });

  test("a transport failure stops the queue and counts as an attempt", async () => {
    const calls = stubFetch(({ url }) => {
      if (url === "/api/notes") throw new TypeError("network down");
      return ok();
    });
    await queue(intent("note.create", { id: "a", content: "1", scope: "global", expiresAt: null }, 1), intent("note.delete", { id: "b" }, 2));
    const result = await drain(send);
    expect(result).toMatchObject({ complete: false, delivered: 0 });
    expect(calls).toHaveLength(1);
    const [first, second] = await sortedOutbox();
    expect(first).toMatchObject({ attempts: 1, lastError: "network down" });
    expect(second.attempts).toBe(0);
  });

  test("a 5xx is retried, not failed", async () => {
    const calls = stubFetch(() => status(503));
    await queue(intent("note.delete", { id: "a" }, 1));
    const result = await drain(send);
    expect(result.complete).toBe(false);
    expect(await ids("failed")).toEqual([]);
    expect((await sortedOutbox())[0]).toMatchObject({ attempts: 1, lastError: "server error 503" });
  });

  test("notSent errors leave the attempt count untouched", async () => {
    const calls = stubFetch(() => {
      throw new Error("offline");
    });
    await queue(intent("note.delete", { id: "a" }, 1));
    const result = await drain(send, { notSent: (err) => (err as Error).message === "offline" });
    expect(result.complete).toBe(false);
    expect((await sortedOutbox())[0]).toMatchObject({ attempts: 0, lastError: null });
  });

  test("a 4xx moves the intent to failed with its payload, drops the ETag and does not block the rest", async () => {
    const calls = stubFetch(({ url }) => (url === "/api/notes/bad" ? status(404, "no such note") : ok()));
    await db.put("meta", { id: "etag", value: "e1" });
    await db.put("meta", { id: "lastSyncedAt", value: "t" });
    await queue(intent("note.delete", { id: "bad" }, 1), intent("note.delete", { id: "good" }, 2));
    const result = await drain(send);
    expect(result).toMatchObject({ complete: true, delivered: 1 });
    expect(calls).toHaveLength(2);
    expect(await ids("outbox")).toEqual([]);
    expect(await db.get<Intent>("failed", "intent-1")).toMatchObject({ payload: { id: "bad" }, lastError: "404: no such note" });
    expect(await db.get("meta", "etag")).toBeUndefined();
    expect(await db.get("meta", "lastSyncedAt")).toBeDefined();
  });

  test("a long 4xx body is cut to 200 characters in lastError", async () => {
    const calls = stubFetch(() => status(400, "x".repeat(500)));
    await queue(intent("note.delete", { id: "a" }, 1));
    await drain(send);
    expect((await db.get<Intent>("failed", "intent-1"))?.lastError).toBe(`400: ${"x".repeat(200)}`);
  });

  test("onChange fires for every delivery and every move to failed", async () => {
    const calls = stubFetch(({ url }) => (url.endsWith("/bad") ? status(400) : ok()));
    await queue(intent("note.delete", { id: "ok" }, 1), intent("note.delete", { id: "bad" }, 2));
    let changes = 0;
    await drain(send, { onChange: () => changes++ });
    expect(changes).toBe(2);
  });

  test("a rating superseded while its request was out is not written back", async () => {
    stubFetch(async () => {
      await db.del("outbox", "intent-1");
      throw new TypeError("network down");
    });
    await queue(intent("rate", { extractionId: "e1", signal: "1" }, 1), intent("note.delete", { id: "after" }, 2));
    const result = await drain(send);
    expect(result.complete).toBe(false);
    expect(await ids("outbox")).toEqual(["intent-2"]);
  });

  test("a superseded intent whose request failed terminally lets the queue move on", async () => {
    const calls = stubFetch(async ({ url }) => {
      if (url === "/api/feedback") {
        await db.del("outbox", "intent-1");
        return status(400);
      }
      return ok();
    });
    await queue(intent("rate", { extractionId: "e1", signal: "1" }, 1), intent("note.delete", { id: "after" }, 2));
    const result = await drain(send);
    expect(result).toMatchObject({ complete: true, delivered: 1 });
    expect(await ids("failed")).toEqual([]);
  });

  test("an empty queue is a complete no-op", async () => {
    const calls = stubFetch(() => ok());
    expect(await drain(send)).toEqual({ complete: true, delivered: 0, changed: [] });
    expect(calls).toHaveLength(0);
  });

  describe("conflict flag", () => {
    const edit = intent("note.update", { id: "n1", patch: { content: "x" }, baseUpdatedAt: "t0" }, 1);

    test("a flagged response marks the note and reports the notes store as changed", async () => {
      await db.put("notes", note("n1"));
      await queue(edit);
      const calls = stubFetch(() => ok({ _conflict: true }));
      const result = await drain(send);
      expect(result.changed).toEqual(["notes"]);
      expect((await db.get<NoteRow>("notes", "n1"))?.conflicted).toBe(true);
    });

    test("a later clean edit clears an earlier flag", async () => {
      await db.put("notes", note("n1", { conflicted: true }));
      await queue(edit);
      const calls = stubFetch(() => ok({}));
      const result = await drain(send);
      expect(result.changed).toEqual(["notes"]);
      expect((await db.get<NoteRow>("notes", "n1"))?.conflicted).toBe(false);
    });

    test("an unflagged edit on an unflagged note reports nothing", async () => {
      await db.put("notes", note("n1"));
      await queue(edit);
      const calls = stubFetch(() => ok({}));
      expect((await drain(send)).changed).toEqual([]);
    });

    test("an unparseable success body counts as no conflict", async () => {
      await db.put("notes", note("n1", { conflicted: true }));
      await queue(edit);
      const calls = stubFetch(() => new Response("not json", { status: 200 }));
      await drain(send);
      expect((await db.get<NoteRow>("notes", "n1"))?.conflicted).toBe(false);
    });

    test("only edits are inspected", async () => {
      await db.put("notes", note("n1"));
      await queue(intent("note.delete", { id: "n1" }, 1));
      const calls = stubFetch(() => ok({ _conflict: true }));
      const result = await drain(send);
      expect(result.changed).toEqual([]);
      expect((await db.get<NoteRow>("notes", "n1"))?.conflicted).toBeUndefined();
    });
  });
});
