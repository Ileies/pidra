/**
 * Minimal IndexedDB wrapper for the offline mirror. No dependency: the
 * surface needed here - get, getAll, put, bulkPut, delete, bulkDelete, clear - is small enough
 * that a wrapper library would be more code to audit than to write.
 *
 * Browser-only. Every store keys its records on a plain string `id` field, even where the natural
 * key is something else (a report's `id` is its date), so one generic implementation covers every
 * store rather than one per shape.
 */

const DB_NAME = "pidra-offline";
/** 2: the reference tables (entities, relations, appearances, contacts, topics).
 *  3: the relation graph is gone (no confirmed edges, no evidence, never read by synthesis - see
 *  docs/scoring-formulas.md) - `entityRelations` is dropped on upgrade rather than left as dead,
 *  unsynced data. An upgrade otherwise only ever adds stores, so it keeps what is there.
 *  4: standing rules became notes - the `rules` store is dropped, along with any queued or failed
 *  `rule.*` writes, which no longer have an endpoint.
 *  5: `entityAppearances` gets an `entityId` index, so one entity's page reads its own rows. */
const DB_VERSION = 5;

/** Secondary indexes, by store. Created on upgrade; `getAllBy` reads them. */
const INDEXES: Partial<Record<Store, string[]>> = { entityAppearances: ["entityId"] };

export const STORES = [
  "reports",
  "extractions",
  "notes",
  "corrections",
  "contextDoc",
  "entities",
  "entityAppearances",
  "contacts",
  "topics",
  "meta",
  "outbox",
  "failed",
] as const;

export type Store = (typeof STORES)[number];

/** The stores the snapshot fills. `meta`, `outbox` and `failed` are not server state. */
export const MIRROR_STORES = [
  "reports",
  "extractions",
  "notes",
  "corrections",
  "contextDoc",
  "entities",
  "entityAppearances",
  "contacts",
  "topics",
] as const satisfies readonly Store[];
export type MirrorStore = (typeof MIRROR_STORES)[number];

export function isMirrorStore(store: string): store is MirrorStore {
  return (MIRROR_STORES as readonly string[]).includes(store);
}

/**
 * Runs `fn` while holding the named Web Lock, so the pages and the service worker never apply a
 * snapshot or drain the outbox at the same time (the worker syncs on push).
 * Without the lock both could send the same queued write. Not re-entrant: nothing that holds a
 * lock may ask for the same one. Where the API is missing, it simply runs.
 */
export function withLock<T>(name: "pidra-outbox" | "pidra-snapshot", fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? locks.request(name, fn) : fn();
}

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
      for (const [name, fields] of Object.entries(INDEXES)) {
        const os = req.transaction!.objectStore(name);
        for (const field of fields) if (!os.indexNames.contains(field)) os.createIndex(field, field);
      }
      // Dropped in version 3, kept here rather than left around unsynced.
      if (db.objectStoreNames.contains("entityRelations")) db.deleteObjectStore("entityRelations");
      if (db.objectStoreNames.contains("rules")) db.deleteObjectStore("rules");
      // A queued or failed rule write has nowhere to go any more; leaving it would jam the drain.
      const tx = req.transaction;
      if (tx) {
        for (const name of ["outbox", "failed"] as const) {
          const cursor = tx.objectStore(name).openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return;
            if (String((at.value as { kind?: unknown }).kind ?? "").startsWith("rule.")) at.delete();
            at.continue();
          };
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer build (another tab, or the service worker after an update) wants to upgrade. An
      // open connection blocks that until it closes, so step aside; the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Runs one request on `store` and resolves with its result. */
async function run<R>(store: Store, mode: IDBTransactionMode, make: (os: IDBObjectStore) => IDBRequest<R>): Promise<R> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = make(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs several writes in one transaction; resolves when it commits. */
async function runBatch(store: Store, write: (os: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    write(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export function get<T extends Keyed>(store: Store, id: string): Promise<T | undefined> {
  return run(store, "readonly", (os) => os.get(id) as IDBRequest<T | undefined>);
}

export function getAll<T extends Keyed>(store: Store): Promise<T[]> {
  return run(store, "readonly", (os) => os.getAll() as IDBRequest<T[]>);
}

/** Every key of a store without cloning its rows. A row's key is its `id`. */
export async function keys(store: Store): Promise<string[]> {
  return (await run(store, "readonly", (os) => os.getAllKeys())).map(String);
}

/** The rows whose `field` equals `value`; only the fields in `INDEXES` can be asked for. */
export function getAllBy<T extends Keyed>(store: Store, field: string, value: string): Promise<T[]> {
  return run(store, "readonly", (os) => os.index(field).getAll(value) as IDBRequest<T[]>);
}

export async function put<T extends Keyed>(store: Store, value: T): Promise<void> {
  await run(store, "readwrite", (os) => os.put(value));
}

/**
 * Rewrites a row only if it is still there, in one transaction. A separate `get` and `put` leave a
 * gap in which a delete can land (a re-tapped rating drops the queued one), and the `put` would
 * bring the deleted row back. Resolves whether the row was there.
 */
export function update<T extends Keyed>(store: Store, id: string, change: (row: T) => T): Promise<boolean> {
  return rewrite(store, store, id, change, false);
}

/** Like `update`, across two stores: the row leaves `from` and lands changed in `to`, or nothing happens. */
export function move<T extends Keyed>(from: Store, to: Store, id: string, change: (row: T) => T): Promise<boolean> {
  return rewrite(from, to, id, change, true);
}

async function rewrite<T extends Keyed>(from: Store, to: Store, id: string, change: (row: T) => T, remove: boolean): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(from === to ? [from] : [from, to], "readwrite");
    let found = false;
    const read = t.objectStore(from).get(id);
    read.onsuccess = () => {
      if (!read.result) return;
      found = true;
      t.objectStore(to).put(change(read.result as T));
      if (remove) t.objectStore(from).delete(id);
    };
    t.oncomplete = () => resolve(found);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("mirror transaction aborted"));
  });
}

export async function bulkPut<T extends Keyed>(store: Store, values: T[]): Promise<void> {
  if (values.length === 0) return;
  await runBatch(store, (os) => values.forEach((value) => os.put(value)));
}

export async function del(store: Store, id: string): Promise<void> {
  await run(store, "readwrite", (os) => os.delete(id));
}

export async function bulkDelete(store: Store, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await runBatch(store, (os) => ids.forEach((id) => os.delete(id)));
}

export async function clear(store: Store): Promise<void> {
  await run(store, "readwrite", (os) => os.clear());
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
 * Applies a snapshot to several stores in **one** transaction, so the
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
