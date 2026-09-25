/**
 * Minimal IndexedDB wrapper for the offline mirror (OFFLINE_PLAN.md §3). No dependency: the
 * surface needed here - get, getAll, put, bulkPut, delete, bulkDelete, clear - is small enough
 * that a wrapper library would be more code to audit than to write.
 *
 * Browser-only. Every store keys its records on a plain string `id` field, even where the natural
 * key is something else (a report's `id` is its date), so one generic implementation covers every
 * store rather than one per shape.
 */

const DB_NAME = "pidra-offline";
const DB_VERSION = 1;

export const STORES = [
  "reports",
  "extractions",
  "notes",
  "rules",
  "corrections",
  "contextDoc",
  "meta",
  "outbox",
  "failed",
] as const;

export type Store = (typeof STORES)[number];

export interface Keyed {
  id: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function get<T extends Keyed>(store: Store, id: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<T extends Keyed>(store: Store): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function put<T extends Keyed>(store: Store, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkPut<T extends Keyed>(store: Store, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const value of values) os.put(value);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function del(store: Store, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function bulkDelete(store: Store, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const id of ids) os.delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function clear(store: Store): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export interface StorePlan {
  store: Store;
  /** Rows to write. One that is identical to what the store already holds is skipped. */
  rows: Keyed[];
  /** Every id the store should hold afterwards; anything else is deleted. Null leaves the rest. */
  keep: string[] | null;
  /** Empty the store first. */
  clear?: boolean;
}

function sameRow(a: unknown, b: unknown): boolean {
  // Both sides come from the same server serialisation, so key order matches for an unchanged
  // row; a row the outbox rewrote optimistically may differ in order and is simply rewritten.
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Applies a snapshot (OFFLINE_PLAN.md §14.3, H2) to several stores in **one** transaction, so the
 * mirror is never half old and half new and the `meta` row that records the snapshot's ETag
 * commits only together with the rows it describes. Rows that did not change are not rewritten,
 * and the answer names the stores that actually did, which is what `sync.ts` invalidates.
 *
 * Everything runs in request callbacks rather than awaits: an IndexedDB transaction commits itself
 * as soon as a turn passes with no request pending, so awaiting anything in between would end it.
 */
export async function reconcile(plans: StorePlan[]): Promise<Store[]> {
  if (plans.length === 0) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(plans.map((plan) => plan.store), "readwrite");
    const changed = new Set<Store>();

    for (const plan of plans) {
      const os = t.objectStore(plan.store);
      if (plan.clear) {
        os.clear();
        changed.add(plan.store);
      }
      // Requests on one store run in order, so after a clear this reads the empty store.
      const read = os.getAll();
      read.onsuccess = () => {
        const existing = new Map((read.result as Keyed[]).map((row) => [row.id, row]));
        for (const row of plan.rows) {
          if (existing.has(row.id) && sameRow(existing.get(row.id), row)) continue;
          os.put(row);
          changed.add(plan.store);
        }
        if (plan.keep) {
          const keep = new Set(plan.keep);
          for (const id of existing.keys()) {
            if (keep.has(id)) continue;
            os.delete(id);
            changed.add(plan.store);
          }
        }
      };
    }

    t.oncomplete = () => resolve([...changed]);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("mirror transaction aborted"));
  });
}
