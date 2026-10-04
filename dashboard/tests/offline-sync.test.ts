import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import * as db from "../src/lib/offline/db.js";
import { pullSnapshot } from "../src/lib/offline/snapshot.js";
import { getLastSyncedAt, onSync, sync, type SyncEvent } from "../src/lib/offline/sync.js";
import { ids, intent, note, ok, queue, resetDb, snapshot, status, stubFetch } from "./offline-helpers.js";
import { invalidated } from "./mocks/app-navigation.js";
import type { NoteRow } from "../src/lib/notes/api.js";

beforeEach(async () => {
  await resetDb();
  invalidated.length = 0;
});
afterEach(() => setSystemTime());

const send = (input: string, init?: RequestInit) => fetch(input, init);
const meta = async (id: string) => (await db.get<{ id: string; value: string }>("meta", id))?.value;
const topic = (id: string) => ({ id });
const SNAPSHOT_URL = "/api/offline/snapshot";

describe("pullSnapshot", () => {
  test("a first pull sends no validator and fills the stores and the meta rows together", async () => {
    const calls = stubFetch(() => ok(snapshot({ notes: [note("n1"), note("n2")], topics: [topic("t1")] }, { etag: "e1", version: "v1" })));
    const result = await pullSnapshot(send);
    expect(calls[0].headers["if-none-match"]).toBeUndefined();
    expect(result.result).toBe("synced");
    expect(result.changed.sort()).toEqual(["notes", "topics"]);
    expect(await ids("notes")).toEqual(["n1", "n2"]);
    expect(await meta("etag")).toBe("e1");
    expect(await meta("mirrorVersion")).toBe("v1");
    expect(await meta("lastSyncedAt")).toBeDefined();
  });

  test("the held ETag goes out quoted as If-None-Match", async () => {
    await db.put("meta", { id: "etag", value: "e1" });
    const calls = stubFetch(() => status(304));
    await pullSnapshot(send);
    expect(calls[0].headers["if-none-match"]).toBe('"e1"');
  });

  test("a 304 only moves lastSyncedAt", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    await db.bulkPut("notes", [note("n1")]);
    await db.put("meta", { id: "etag", value: "e1" });
    stubFetch(() => status(304));
    expect(await pullSnapshot(send)).toEqual({ result: "unchanged", changed: [] });
    expect(await meta("lastSyncedAt")).toBe("2026-10-04T12:00:00.000Z");
    expect(await meta("etag")).toBe("e1");
    expect(await ids("notes")).toEqual(["n1"]);
  });

  test("a full body prunes every row it does not list", async () => {
    await db.put("meta", { id: "etag", value: "old" });
    await db.bulkPut("notes", [note("keep"), note("gone")]);
    stubFetch(() => ok(snapshot({ notes: [note("keep"), note("new")] }, { etag: "e2", ids: { notes: ["keep", "new"] } })));
    await pullSnapshot(send);
    expect(await ids("notes")).toEqual(["keep", "new"]);
  });

  test("a delta writes the changed rows and prunes by the id list, leaving the rest", async () => {
    await db.put("meta", { id: "etag", value: "e1" });
    await db.put("meta", { id: "mirrorVersion", value: "v1" });
    await db.bulkPut("notes", [note("a"), note("b"), note("c", { content: "old" })]);
    stubFetch(() =>
      ok(snapshot({ notes: [note("c", { content: "new" })] }, { etag: "e2", mode: "delta", base: "e1", ids: { notes: ["a", "c"] } })),
    );
    const result = await pullSnapshot(send);
    expect(result.changed).toEqual(["notes"]);
    expect(await ids("notes")).toEqual(["a", "c"]);
    expect((await db.get<NoteRow>("notes", "c"))?.content).toBe("new");
    expect(await meta("etag")).toBe("e2");
  });

  test("a delta against a version the mirror does not hold drops the ETag, throws and changes nothing", async () => {
    await db.put("meta", { id: "etag", value: "e1" });
    await db.bulkPut("notes", [note("a")]);
    stubFetch(() => ok(snapshot({ notes: [note("z")] }, { mode: "delta", base: "someone-else", ids: { notes: ["z"] } })));
    await expect(pullSnapshot(send)).rejects.toThrow("delta against a version this mirror does not hold");
    expect(await meta("etag")).toBeUndefined();
    expect(await ids("notes")).toEqual(["a"]);
  });

  test("a build the mirror has not seen replaces it, but never touches the outbox or the failed list", async () => {
    await db.put("meta", { id: "mirrorVersion", value: "v1" });
    await db.put("meta", { id: "etag", value: "e1" });
    await db.bulkPut("notes", [note("old")]);
    await db.bulkPut("topics", [topic("stale")]);
    await queue(intent("note.delete", { id: "q" }, 1));
    await db.put("failed", intent("note.delete", { id: "f" }, 2));
    stubFetch(() => ok(snapshot({ notes: [note("fresh")] }, { version: "v2", etag: "e2" })));
    await pullSnapshot(send);
    expect(await ids("notes")).toEqual(["fresh"]);
    expect(await ids("topics")).toEqual([]);
    expect(await meta("mirrorVersion")).toBe("v2");
    expect(await ids("outbox")).toEqual(["intent-1"]);
    expect(await ids("failed")).toEqual(["intent-2"]);
  });

  test("the same build merges instead of clearing", async () => {
    await db.put("meta", { id: "mirrorVersion", value: "v1" });
    await db.bulkPut("topics", [topic("kept")]);
    stubFetch(() => ok(snapshot({ notes: [note("n")] }, { version: "v1" })));
    await pullSnapshot(send);
    expect(await ids("topics")).toEqual(["kept"]);
  });

  test("a queued write is re-asserted over the row the server just sent", async () => {
    await db.put("notes", note("n1", { content: "before" }));
    await queue(intent("note.update", { id: "n1", patch: { content: "my edit" }, baseUpdatedAt: null }, 1));
    stubFetch(() => ok(snapshot({ notes: [note("n1", { content: "server" })] })));
    await pullSnapshot(send);
    expect((await db.get<NoteRow>("notes", "n1"))?.content).toBe("my edit");
  });

  test("pulling the same snapshot again changes nothing", async () => {
    const body = snapshot({ notes: [note("n1")] });
    stubFetch(() => ok(body));
    await pullSnapshot(send);
    const again = await pullSnapshot(send);
    expect(again.changed).toEqual([]);
  });

  test("an error status throws and leaves the mirror as it was", async () => {
    await db.bulkPut("notes", [note("n1")]);
    stubFetch(() => status(500));
    await expect(pullSnapshot(send)).rejects.toThrow("snapshot 500");
    expect(await ids("notes")).toEqual(["n1"]);
    expect(await meta("lastSyncedAt")).toBeUndefined();
  });
});

describe("sync", () => {
  const body = () => ok(snapshot({ notes: [note("n1")] }));
  const snapshotCalls = (calls: { url: string }[]) => calls.filter((c) => c.url === SNAPSHOT_URL);

  test("an empty mirror pulls, records the time and invalidates what changed plus the status key", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    stubFetch(body);
    expect(await getLastSyncedAt()).toBeNull();
    expect(await sync()).toBe("synced");
    expect(await getLastSyncedAt()).toBe("2026-10-04T12:00:00.000Z");
    expect(invalidated.at(-1)).toEqual(["mirror:notes", "mirror:status"]);
  });

  test("later pulls invalidate only the changed stores, not the status key", async () => {
    stubFetch(body);
    await sync({ force: true });
    invalidated.length = 0;
    stubFetch(() => ok(snapshot({ notes: [note("n1"), note("n2")] })));
    await sync({ force: true });
    expect(invalidated.at(-1)).toEqual(["mirror:notes"]);
  });

  test("a 304 on a filled mirror reports unchanged and invalidates nothing", async () => {
    stubFetch(body);
    await sync({ force: true });
    invalidated.length = 0;
    stubFetch(() => status(304));
    expect(await sync({ force: true })).toBe("unchanged");
    expect(invalidated).toEqual([]);
  });

  test("a pull inside the minute is skipped without a request; force and the passing minute lift it", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    const calls = stubFetch(body);
    await sync();
    expect(snapshotCalls(calls)).toHaveLength(1);

    setSystemTime(new Date("2026-10-04T12:00:30.000Z"));
    expect(await sync()).toBe("skipped");
    expect(snapshotCalls(calls)).toHaveLength(1);

    expect(await sync({ force: true })).toBe("synced");
    expect(snapshotCalls(calls)).toHaveLength(2);

    setSystemTime(new Date("2026-10-04T12:01:31.000Z"));
    expect(await sync()).toBe("synced");
    expect(snapshotCalls(calls)).toHaveLength(3);
  });

  test("an empty mirror is always due, however recent the last attempt", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    const calls = stubFetch(body);
    await sync();
    await resetDb();
    expect(await sync()).toBe("synced");
    expect(snapshotCalls(calls)).toHaveLength(2);
  });

  test("concurrent callers share one pull", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls = stubFetch(async () => {
      await gate;
      return body();
    });
    const first = sync();
    const second = sync({ force: true });
    expect(second).toBe(first);
    release();
    expect(await first).toBe("synced");
    expect(snapshotCalls(calls)).toHaveLength(1);
  });

  test("queued writes go out before the snapshot is requested", async () => {
    const calls = stubFetch(({ url }) => (url === SNAPSHOT_URL ? body() : ok()));
    await queue(intent("note.delete", { id: "n1" }, 1));
    await sync();
    expect(calls.map((c) => c.url)).toEqual(["/api/notes/n1", SNAPSHOT_URL]);
    expect(await ids("outbox")).toEqual([]);
  });

  test("a write that cannot go out does not stop the pull, and stays queued over what the pull brings", async () => {
    stubFetch(({ url }) => {
      if (url === SNAPSHOT_URL) return ok(snapshot({ notes: [note("n1", { content: "server" })] }));
      throw new TypeError("network down");
    });
    await queue(intent("note.update", { id: "n1", patch: { content: "mine" }, baseUpdatedAt: null }, 1));
    expect(await sync()).toBe("synced");
    expect(await ids("outbox")).toEqual(["intent-1"]);
    expect((await db.get<NoteRow>("notes", "n1"))?.content).toBe("mine");
  });

  test("a failed pull reports failed, keeps the mirror, and still counts toward the throttle", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    stubFetch(body);
    await sync();
    setSystemTime(new Date("2026-10-04T12:05:00.000Z"));
    const calls = stubFetch(() => status(500));
    expect(await sync()).toBe("failed");
    expect(await ids("notes")).toEqual(["n1"]);
    setSystemTime(new Date("2026-10-04T12:05:10.000Z"));
    expect(await sync()).toBe("skipped");
    expect(snapshotCalls(calls)).toHaveLength(1);
  });

  test("a transport error also reports failed", async () => {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    expect(await sync()).toBe("failed");
  });

  test("listeners see start then end with the result and the changed stores, until they unsubscribe", async () => {
    stubFetch(body);
    const events: SyncEvent[] = [];
    const off = onSync((event) => events.push(event));
    await sync({ force: true });
    expect(events).toEqual([{ phase: "start" }, { phase: "end", result: "synced", changed: ["notes"] }]);
    off();
    await sync({ force: true });
    expect(events).toHaveLength(2);
  });

  test("a skipped sync emits nothing", async () => {
    setSystemTime(new Date("2026-10-04T12:00:00.000Z"));
    stubFetch(body);
    await sync();
    const events: SyncEvent[] = [];
    const off = onSync((event) => events.push(event));
    expect(await sync()).toBe("skipped");
    off();
    expect(events).toEqual([]);
  });
});
