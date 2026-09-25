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
 * - **Cheap when nothing moved.** A `304`, or a delta of the rows that changed; see `snapshot.ts`,
 *   which does the pull itself and which the service worker runs too.
 *
 * `flush()` runs first so a snapshot never overwrites a write with the pre-write state the server
 * had a moment ago, and the pull re-asserts anything that still could not flush on top of what it
 * brought back, rather than letting it look discarded until it lands.
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
