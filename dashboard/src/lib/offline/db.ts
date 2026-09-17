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

/** Deletes every record in `store` whose id is not in `keepIds`. Used after a full-replace pull
 *  (OFFLINE_PLAN.md §5) to prune rows that fell outside the window or were deleted server-side,
 *  without the server needing to compute an explicit tombstone list. */
export async function pruneToIds(store: Store, keepIds: string[]): Promise<void> {
  const keep = new Set(keepIds);
  const existing = await getAll<Keyed>(store);
  const drop = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  await bulkDelete(store, drop);
}
