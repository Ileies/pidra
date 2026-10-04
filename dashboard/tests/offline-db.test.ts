import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as db from "../src/lib/offline/db.js";
import { ids, resetDb } from "./offline-helpers.js";

beforeEach(resetDb);

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("reconcile", () => {
  test("writes new rows, reports the stores that changed, and leaves identical rows alone", async () => {
    await db.bulkPut("notes", [row("a", { v: 1 })]);
    const changed = await db.reconcile([
      { store: "notes", rows: [row("a", { v: 1 })], keep: null },
      { store: "topics", rows: [row("t1")], keep: null },
    ]);
    expect(changed).toEqual(["topics"]);
    expect(await ids("topics")).toEqual(["t1"]);
  });

  test("rewrites a row whose content differs", async () => {
    await db.bulkPut("notes", [row("a", { v: 1 })]);
    expect(await db.reconcile([{ store: "notes", rows: [row("a", { v: 2 })], keep: null }])).toEqual(["notes"]);
    expect(await db.get("notes", "a")).toEqual({ id: "a", v: 2 });
  });

  test("keep prunes rows the server no longer has, and null keeps everything", async () => {
    await db.bulkPut("notes", [row("a"), row("b"), row("c")]);
    expect(await db.reconcile([{ store: "notes", rows: [], keep: ["a", "c"] }])).toEqual(["notes"]);
    expect(await ids("notes")).toEqual(["a", "c"]);
    expect(await db.reconcile([{ store: "notes", rows: [], keep: null }])).toEqual([]);
    expect(await ids("notes")).toEqual(["a", "c"]);
  });

  test("an empty keep list empties the store", async () => {
    await db.bulkPut("notes", [row("a")]);
    await db.reconcile([{ store: "notes", rows: [], keep: [] }]);
    expect(await ids("notes")).toEqual([]);
  });

  test("clear empties the store first, then writes the rows", async () => {
    await db.bulkPut("notes", [row("old1"), row("old2")]);
    const changed = await db.reconcile([{ store: "notes", rows: [row("new")], keep: ["new"], clear: true }]);
    expect(changed).toEqual(["notes"]);
    expect(await ids("notes")).toEqual(["new"]);
  });

  test("a clear followed by the same row writes it back", async () => {
    await db.bulkPut("notes", [row("a")]);
    await db.reconcile([{ store: "notes", rows: [row("a")], keep: null, clear: true }]);
    expect(await ids("notes")).toEqual(["a"]);
  });

  test("nothing to plan is a no-op", async () => {
    expect(await db.reconcile([])).toEqual([]);
  });

  test("all stores commit together or not at all", async () => {
    await db.bulkPut("notes", [row("a")]);
    // A row without the keyPath makes the transaction fail; the earlier store's write must not stay.
    const bad = db.reconcile([
      { store: "topics", rows: [row("t1")], keep: null },
      { store: "notes", rows: [{} as db.Keyed], keep: null },
    ]);
    await expect(bad).rejects.toBeDefined();
    expect(await ids("topics")).toEqual([]);
    expect(await ids("notes")).toEqual(["a"]);
  });
});

describe("store helpers", () => {
  test("bulkPut and bulkDelete with nothing to do resolve without opening a transaction", async () => {
    await db.bulkPut("notes", []);
    await db.bulkDelete("notes", []);
    expect(await ids("notes")).toEqual([]);
  });

  test("bulkDelete removes only the named rows", async () => {
    await db.bulkPut("notes", [row("a"), row("b"), row("c")]);
    await db.bulkDelete("notes", ["a", "c"]);
    expect(await ids("notes")).toEqual(["b"]);
  });

  test("update rewrites a present row and never creates a missing one", async () => {
    await db.bulkPut("outbox", [row("a", { n: 1 })]);
    expect(await db.update<db.Keyed & { n: number }>("outbox", "a", (r) => ({ ...r, n: r.n + 1 }))).toBe(true);
    expect(await db.get("outbox", "a")).toEqual({ id: "a", n: 2 });
    expect(await db.update("outbox", "gone", (r) => r)).toBe(false);
    expect(await ids("outbox")).toEqual(["a"]);
  });

  test("move carries a changed row from one store to the other, or does nothing if it is gone", async () => {
    await db.bulkPut("outbox", [row("a", { n: 1 })]);
    expect(await db.move<db.Keyed & { n: number }>("outbox", "failed", "a", (r) => ({ ...r, n: 9 }))).toBe(true);
    expect(await ids("outbox")).toEqual([]);
    expect(await db.get("failed", "a")).toEqual({ id: "a", n: 9 });
    expect(await db.move("outbox", "failed", "a", (r) => r)).toBe(false);
    expect(await ids("failed")).toEqual(["a"]);
  });

  test("get on a missing id is undefined", async () => {
    expect(await db.get("notes", "missing")).toBeUndefined();
  });

  test("isMirrorStore separates server state from the outbox, the failed list and meta", () => {
    for (const store of ["reports", "extractions", "notes", "topics", "contextDoc"]) expect(db.isMirrorStore(store)).toBe(true);
    for (const store of ["outbox", "failed", "meta", "rules"]) expect(db.isMirrorStore(store)).toBe(false);
  });
});

describe("withLock", () => {
  const navigatorWith = (locks: unknown) => Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
  afterEach(() => navigatorWith(undefined));

  test("runs the work directly where Web Locks are missing", async () => {
    navigatorWith(undefined);
    expect(await db.withLock("pidra-outbox", async () => 7)).toBe(7);
  });

  test("runs the work under the named lock where they exist", async () => {
    const requested: string[] = [];
    navigatorWith({ request: (name: string, fn: () => Promise<unknown>) => (requested.push(name), fn()) });
    expect(await db.withLock("pidra-snapshot", async () => "done")).toBe("done");
    expect(requested).toEqual(["pidra-snapshot"]);
  });
});

describe("upgrade", () => {
  /** Closes the app's connection (`onversionchange` steps aside), then rebuilds the database as an
   *  older build left it, so the next call reopens at the current version and runs the upgrade. */
  async function seedOlderVersion(version: number, rows: Record<string, { id: string; kind?: string }[]>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase("pidra-offline");
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("pidra-offline", version);
      open.onupgradeneeded = () => {
        for (const [store, values] of Object.entries(rows)) {
          const created = open.result.createObjectStore(store, { keyPath: "id" });
          for (const value of values) created.put(value);
        }
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
  }

  test("drops the retired stores and any queued or failed rule.* write, and keeps everything else", async () => {
    await seedOlderVersion(3, {
      outbox: [{ id: "q1", kind: "rule.create" }, { id: "q2", kind: "note.create" }],
      failed: [{ id: "f1", kind: "rule.update" }, { id: "f2", kind: "rate" }],
      notes: [{ id: "n1" }],
      rules: [{ id: "r1" }],
      entityRelations: [{ id: "x1" }],
    });

    expect(await ids("outbox")).toEqual(["q2"]);
    expect(await ids("failed")).toEqual(["f2"]);
    expect(await ids("notes")).toEqual(["n1"]);
    const names = await new Promise<string[]>((resolve) => {
      const open = indexedDB.open("pidra-offline");
      open.onsuccess = () => {
        const list = [...open.result.objectStoreNames];
        open.result.close();
        resolve(list);
      };
    });
    expect(names).not.toContain("rules");
    expect(names).not.toContain("entityRelations");
    expect(names.sort()).toEqual([...db.STORES].sort());
  });
});
