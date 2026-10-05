/**
 * One pull of `GET /api/offline/snapshot` into the mirror, runnable by pages (`sync.ts`) and the
 * service worker (`sw/sync.ts`): imports only `db.ts` and `intents.ts`, the transport is injected,
 * re-rendering is the caller's business. Body type: `SnapshotBody` in lib/mirror/types.ts; server
 * side: `lib/server/offline/snapshot.ts` + `snapshotCache.ts`. Writes IndexedDB mirror stores and `meta`
 * (`etag`, `mirrorVersion`, `lastSyncedAt`).
 *
 * Protocol: send the held ETag; the server answers 304, a delta, or full. Every body lists all ids
 * per store, so rows the server dropped are pruned without tombstones. One `db.reconcile`
 * transaction applies it, then `reapplyPending` re-asserts queued intents. Runs under the
 * `pidra-snapshot` lock; the caller flushes the outbox first, outside it.
 */

import * as db from "./db.js";
import { isMirrorStore, MIRROR_STORES, type MirrorStore } from "./db.js";
import { reapplyPending } from "./intents.js";
import type { Fetcher, SnapshotBody } from "#lib/mirror/types.js";

export interface PullResult {
  /** `synced`: new rows arrived. `unchanged`: the server confirmed the mirror is current (304). */
  result: "synced" | "unchanged";
  changed: MirrorStore[];
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

  // A new build version clears every mirror store instead of merging across a possible schema
  // change. Such a body is always full (the version is part of the ETag). "outbox" and "failed"
  // are never touched: they hold real queued writes.
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
