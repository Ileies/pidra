/**
 * One pull of `/api/offline/snapshot` into the mirror, in the form
 * both the pages (`sync.ts`) and the service worker (on push, on a periodic sync) can run. It
 * imports nothing but `db.ts` and `intents.ts`; the transport is handed in, and whatever should
 * re-render afterwards is the caller's business.
 *
 * The client sends the ETag of the snapshot it holds; the server answers `304`, or a delta of the
 * rows that changed since, or everything (`#lib/server/snapshotCache.ts`). Either body lists every
 * id per store, so a row the server no longer has is pruned without a tombstone list, and one
 * transaction applies it all (`db.reconcile`), skipping rows that are already identical. Anything
 * still queued is re-asserted on top afterwards (`reapplyPending`), so a pull never makes a
 * pending write look discarded.
 *
 * Under the `pidra-snapshot` lock, so a page and the worker never apply two snapshots at once.
 * The caller flushes the outbox first, outside this lock.
 */

import * as db from "./db.js";
import { isMirrorStore, MIRROR_STORES, type MirrorStore } from "./db.js";
import { reapplyPending, type Fetcher } from "./intents.js";

export interface PullResult {
  /** `synced`: new rows arrived. `unchanged`: the server confirmed the mirror is current (304). */
  result: "synced" | "unchanged";
  changed: MirrorStore[];
}

interface SnapshotBody {
  version: string;
  etag: string;
  mode: "full" | "delta";
  base: string | null;
  generatedAt: string;
  stores: Partial<Record<MirrorStore, { id: string }[]>>;
  ids: Partial<Record<MirrorStore, string[]>>;
}

export async function meta(id: string): Promise<string | undefined> {
  return (await db.get<{ id: string; value: string }>("meta", id))?.value;
}

/** Throws on anything but a 200 or a 304: the transport's own error, or the status. */
export function pullSnapshot(send: Fetcher): Promise<PullResult> {
  return db.withLock("pidra-snapshot", async () => {
    const [etag, version] = await Promise.all([meta("etag"), meta("mirrorVersion")]);
    const res = await send("/api/offline/snapshot", {
      cache: "no-store",
      headers: etag ? { "If-None-Match": `"${etag}"` } : {},
    });

    if (res.status === 304) {
      await db.put("meta", { id: "lastSyncedAt", value: new Date().toISOString() });
      return { result: "unchanged", changed: [] };
    }
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const changed = await apply((await res.json()) as SnapshotBody, etag ?? null, version ?? null);
    await reapplyPending();
    return { result: "synced", changed };
  });
}

async function apply(body: SnapshotBody, heldEtag: string | null, heldVersion: string | null): Promise<MirrorStore[]> {
  if (body.mode === "delta" && body.base !== heldEtag) {
    // Cannot happen with this server, which only diffs against the ETag it was sent. If something
    // in between ever mixes them up, the next pull is a full one rather than a wrong merge.
    await db.del("meta", "etag");
    throw new Error("delta against a version this mirror does not hold");
  }

  // A build the client has never seen replaces whatever it had cached rather than merging across
  // a possible schema change. Such a body is always full: the version is part
  // of the ETag, so no delta spans it. "outbox" and "failed" are never touched - they hold real
  // queued writes, not mirrored server state.
  const newVersion = !!heldVersion && heldVersion !== body.version;
  const plans: db.StorePlan[] = MIRROR_STORES.map((store) => ({
    store,
    rows: body.stores[store] ?? [],
    keep: body.ids[store] ?? null,
    clear: newVersion,
  }));
  // In the same transaction, so the ETag never describes rows that did not commit.
  const metaRows: { id: string; value: string }[] = [
    { id: "lastSyncedAt", value: new Date().toISOString() },
    { id: "mirrorVersion", value: body.version },
    { id: "etag", value: body.etag },
  ];
  plans.push({ store: "meta", rows: metaRows, keep: null });

  return (await db.reconcile(plans)).filter(isMirrorStore);
}
