/**
 * Pulls the offline snapshot into the mirror (OFFLINE_PLAN.md §5, §14.3 H2). Always in the
 * background: nothing on screen waits for this, because a page reads the mirror and a finished sync
 * re-runs exactly the loads that read what changed (`deps.ts`).
 *
 * - **Single-flight.** Every caller while a pull is running gets that pull's promise, so a cold
 *   start, a day step and a tap-preload no longer download the snapshot three times in parallel.
 * - **Throttled.** At most one pull a minute. `force` skips that for the moments a fresh copy is
 *   actually expected: "Sync now", app start, coming back to the foreground after a while, a write
 *   that went to the server directly. An empty mirror is always due.
 * - **Cheap when nothing moved.** The client sends the ETag of the snapshot it holds; the server
 *   answers `304`, or a delta of the rows that changed since, or everything
 *   (`#lib/server/snapshotCache.ts`). Either body lists every id per store, so a row the server no
 *   longer has is pruned without a tombstone list, and one transaction applies it all
 *   (`db.reconcile`), skipping rows that are already identical.
 *
 * `flush()` runs first so a snapshot never overwrites a write with the pre-write state the server
 * had a moment ago, and `reapplyPending()` runs after so anything that still could not flush is
 * re-asserted on top of what the pull brought back, rather than looking discarded until it lands.
 */

import * as db from "./db.js";
import * as outbox from "./outbox.js";
import { BUDGET, net, NetError, reachability } from "./net.js";
import { invalidateMirror, isMirrorStore, MIRROR_STORES, type MirrorStore } from "./deps.js";

/**
 * `synced`: new rows arrived. `unchanged`: the server confirmed the mirror is current (304).
 * `skipped`: throttled, nothing sent. `offline`: pronix not reachable. `failed`: it was, and the
 * pull still did not complete.
 */
export type SyncResult = "synced" | "unchanged" | "skipped" | "offline" | "failed";

export type SyncEvent =
  | { phase: "start" }
  | { phase: "end"; result: SyncResult; changed: MirrorStore[] };

const MIN_INTERVAL_MS = 60_000;

let inFlight: Promise<SyncResult> | null = null;
/** When the last pull reached the server, successful or not. Drives the throttle. */
let lastAttemptAt = 0;
let persistAsked = false;
const listeners = new Set<(event: SyncEvent) => void>();

/** `state.svelte.ts` turns these into the header dot, the sync sheet and the first-sync state. */
export function onSync(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: SyncEvent): void {
  for (const listener of listeners) listener(event);
}

export function sync(options: { force?: boolean } = {}): Promise<SyncResult> {
  inFlight ??= run(options.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function getLastSyncedAt(): Promise<string | null> {
  return (await meta("lastSyncedAt")) ?? null;
}

async function meta(id: string): Promise<string | undefined> {
  return (await db.get<{ id: string; value: string }>("meta", id))?.value;
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

async function run(force: boolean): Promise<SyncResult> {
  const [etag, version, syncedAt] = await Promise.all([meta("etag"), meta("mirrorVersion"), meta("lastSyncedAt")]);
  const empty = !syncedAt;
  if (!force && !empty && Date.now() - lastAttemptAt < MIN_INTERVAL_MS) return "skipped";
  // `net()` would refuse in the same frame; skipping here also keeps the header from blinking.
  if (reachability() === "offline") return "offline";

  emit({ phase: "start" });
  let result: SyncResult;
  let changed: MirrorStore[] = [];
  try {
    await outbox.flush().catch(() => {});
    const res = await net(
      "/api/offline/snapshot",
      { cache: "no-store", headers: etag ? { "If-None-Match": `"${etag}"` } : {} },
      { budgetMs: BUDGET.sync },
    );
    lastAttemptAt = Date.now();

    if (res.status === 304) {
      await db.put("meta", { id: "lastSyncedAt", value: new Date().toISOString() });
      result = "unchanged";
    } else {
      if (!res.ok) throw new Error(`snapshot ${res.status}`);
      changed = await apply((await res.json()) as SnapshotBody, etag ?? null, version ?? null);
      await outbox.reapplyPending();
      result = "synced";
    }
    if (!persistAsked) {
      persistAsked = true;
      void persistStorage();
    }
  } catch (err) {
    // Sent and lost counts toward the throttle too: a slow link would otherwise start another
    // full-budget pull on every navigation.
    if (!(err instanceof NetError) || err.sent) lastAttemptAt = Date.now();
    result = err instanceof NetError && err.kind === "offline" ? "offline" : "failed";
  }

  const filled = empty && (result === "synced" || result === "unchanged");
  await invalidateMirror(filled ? [...changed, "status"] : changed);
  emit({ phase: "end", result, changed });
  return result;
}

async function apply(body: SnapshotBody, heldEtag: string | null, heldVersion: string | null): Promise<MirrorStore[]> {
  if (body.mode === "delta" && body.base !== heldEtag) {
    // Cannot happen with this server, which only diffs against the ETag it was sent. If something
    // in between ever mixes them up, the next pull is a full one rather than a wrong merge.
    await db.del("meta", "etag");
    throw new Error("delta against a version this mirror does not hold");
  }

  // A build the client has never seen replaces whatever it had cached rather than merging across
  // a possible schema change (OFFLINE_PLAN.md §5). Such a body is always full: the version is part
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

/**
 * Asks the browser not to evict the mirror and, more importantly, the outbox, which holds writes
 * that exist nowhere else (OFFLINE_PLAN.md §12). Once per session, after a sync proved the app is
 * in real use; an installed PWA is usually granted without a prompt.
 */
async function persistStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    await navigator.storage.persist();
  } catch {
    // Not supported, or refused. The sync sheet says which.
  }
}
