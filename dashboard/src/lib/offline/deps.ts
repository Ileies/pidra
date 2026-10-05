/**
 * How a page learns that the mirror changed under it. `repo.ts` reads declare
 * `depends(mirrorKey(store))` per store touched; the mirror writers (`sync.ts`, `outbox.ts`,
 * `state.svelte.ts`) call `invalidateMirror` with exactly the stores they changed, so only those
 * loads re-run.
 *
 * `mirror:status` is the one key that is not a store: it moves when the mirror goes from empty to
 * filled or back ("Clear offline data"), which is when the layout swaps between the first-sync
 * state and the page. Every repo read registers it.
 */

import { invalidate } from "$app/navigation";
import type { MirrorStore } from "./db.js";

// The store list lives in `db.ts`, which the service worker can import; this module cannot be.
export { MIRROR_STORES, isMirrorStore, type MirrorStore } from "./db.js";

export type MirrorKey = `mirror:${MirrorStore | "status"}`;

export function mirrorKey(store: MirrorStore | "status"): MirrorKey {
  return `mirror:${store}`;
}

/** Resolves once the current page has re-rendered from the changed stores. */
export async function invalidateMirror(stores: (MirrorStore | "status")[]): Promise<void> {
  if (stores.length === 0) return;
  const keys = new Set<string>(stores.map(mirrorKey));
  try {
    await invalidate((url) => keys.has(url.href));
  } catch {
    // Before the router has started there is no page to re-run; the first load reads fresh data.
  }
}
