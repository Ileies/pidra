/**
 * Page-side orchestration of one snapshot pull into the mirror (the pull itself is `snapshot.ts`,
 * shared with the service worker). Always background: pages read the mirror and a finished sync
 * re-runs exactly the loads that read what changed (`deps.ts`). Called by `repo.ts` on every read.
 *
 * - Single-flight: callers during a pull share its promise.
 * - Throttled to one pull per `MIN_INTERVAL_MS`; `force` skips that ("Sync now", app start,
 *   foregrounding, a write that went to the server directly). An empty mirror is always due.
 * - `outbox.flush()` runs first so a snapshot never overwrites a write with pre-write server state;
 *   `pullSnapshot` re-asserts still-queued intents afterwards.
 */

import * as outbox from "./outbox.js";
import { BUDGET, net, NetError, reachability } from "./net.js";
import { invalidateMirror, type MirrorStore } from "./deps.js";
import { meta, pullSnapshot } from "./snapshot.js";

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

/** Never throws: failures come back as a `SyncResult`. Invalidates the loads of changed stores. */
export function sync(options: { force?: boolean } = {}): Promise<SyncResult> {
  inFlight ??= run(options.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function getLastSyncedAt(): Promise<string | null> {
  return (await meta("lastSyncedAt")) ?? null;
}

async function run(force: boolean): Promise<SyncResult> {
  const empty = !(await meta("lastSyncedAt"));
  if (!force && !empty && Date.now() - lastAttemptAt < MIN_INTERVAL_MS) return "skipped";
  // `net()` would refuse in the same frame; skipping here also keeps the header from blinking.
  if (reachability() === "offline") return "offline";

  emit({ phase: "start" });
  let result: SyncResult;
  let changed: MirrorStore[] = [];
  try {
    await outbox.flush().catch(() => {});
    const pulled = await pullSnapshot(async (input, init) => {
      const res = await net(input, init, { budgetMs: BUDGET.sync });
      lastAttemptAt = Date.now();
      return res;
    });
    result = pulled.result;
    changed = pulled.changed;
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

/**
 * Asks the browser not to evict the mirror or, more importantly, the outbox (writes that exist
 * nowhere else). Once per session, after a first successful pull.
 */
async function persistStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    await navigator.storage.persist();
  } catch {
    // Not supported, or refused. The sync sheet says which.
  }
}
