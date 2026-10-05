/**
 * **The worker syncs, too**. The 06:30 push pulls the snapshot while the notification is shown, so
 * the morning briefing is in the mirror before it is tapped, including on a phone that then goes
 * on a train and loses signal. Queued writes flush from here on Background Sync (`pidra-outbox`,
 * registered by `outbox.ts` when a write could not go out) and on the push, and a periodic sync
 * refreshes the mirror where the browser grants one. All of it is the same code the pages run
 * (`intents.ts`, `snapshot.ts`), under the same Web Locks, with this worker's own bounded
 * transport; an open page is told which stores changed and re-renders them.
 */

import { self } from "$app/service-worker";
import { buffered, isOurs } from "#lib/offline/guard.js";
import { drain } from "#lib/offline/intents.js";
import { pullSnapshot } from "#lib/offline/snapshot.js";
import type { MirrorStore } from "#lib/offline/db.js";
import { reach } from "./shared.js";

/**
 * Each request the worker's own sync makes. A push gives the worker little time (iOS is the tight
 * one), and a blackhole would otherwise hold it until the OS gives up; the full snapshot is 178 kB
 * compressed, well inside this over a working link.
 */
const SYNC_BUDGET_MS = 20_000;

/**
 * The worker's transport for `drain` and `pullSnapshot`: bounded, and a response without the
 * `x-pidra` stamp is someone else's, exactly as `net.ts` decides it in a page.
 */
class NotSent extends Error {}

async function syncFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!self.navigator.onLine) throw new NotSent("offline");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_BUDGET_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!isOurs(response)) throw new Error("answered by something other than the app");
    const settled = await buffered(response);
    reach.offline = false;
    return settled;
  } catch (err) {
    reach.offline = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Tells every open page which stores changed, so it re-renders them (`state.svelte.ts`). A pull
 *  that changed nothing is still said: it moved `lastSyncedAt`, which the page shows. */
async function announce(stores: MirrorStore[], outbox: boolean, pulled: boolean): Promise<void> {
  if (stores.length === 0 && !outbox && !pulled) return;
  const windows = await self.clients.matchAll({ type: "window" });
  for (const client of windows) client.postMessage({ type: "pidra:mirror-changed", stores, outbox });
}

interface WorkerSyncResult {
  /** False when a queued write is still waiting on the network. */
  flushed: boolean;
  pulled: boolean;
}

let syncing: Promise<WorkerSyncResult> | null = null;

/**
 * Drain the outbox, then pull the snapshot, like `sync.ts` in a page. `pull: "if-flushed"` only
 * pulls when a write actually went out, which is all a Background Sync for the queue needs; the
 * page does its own pull when it is open.
 */
export function workerSync(pull: "always" | "if-flushed"): Promise<WorkerSyncResult> {
  syncing ??= (async () => {
    const drained = await drain(syncFetch, { notSent: (err) => err instanceof NotSent }).catch(() => ({
      complete: false,
      delivered: 0,
      changed: [] as MirrorStore[],
    }));
    let pulled = false;
    let changed = drained.changed;
    if (pull === "always" || drained.delivered > 0) {
      try {
        const result = await pullSnapshot(syncFetch);
        changed = [...new Set([...changed, ...result.changed])];
        pulled = true;
      } catch {
        // Offline or failed; the page's own sync tries again when it opens.
      }
    }
    await announce(changed, drained.delivered > 0, pulled);
    return { flushed: drained.complete, pulled };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Background Sync and Periodic Background Sync, which lib.webworker does not type. */
interface TaggedSyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener("sync", (event) => {
  const sync = event as TaggedSyncEvent;
  if (sync.tag !== "pidra-outbox") return;
  // Rejecting tells the browser the queue is not empty yet, and it retries with its own backoff.
  sync.waitUntil(
    workerSync("if-flushed").then((result) => {
      if (!result.flushed) throw new Error("outbox still queued");
    }),
  );
});

self.addEventListener("periodicsync", (event) => {
  const sync = event as TaggedSyncEvent;
  if (sync.tag === "pidra-mirror") sync.waitUntil(workerSync("always"));
});
