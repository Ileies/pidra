/**
 * How a page learns that the mirror changed under it (OFFLINE_PLAN.md §14.3, H2). Every Tier A load
 * reads through `repo.ts`, which declares `depends(mirrorKey(store))` for each store it touched, and
 * the two writers of the mirror (`sync.ts`, `outbox.ts`) invalidate exactly the stores they
 * changed. So a background sync that brought a new note re-runs `/notes` and nothing else, and
 * never the root layout, which is what `refreshAll()` did.
 *
 * `mirror:status` is the one key that is not a store: it moves when the mirror goes from empty to
 * filled or back ("Clear offline data"), which is when the layout swaps between the first-sync
 * state and the page. Every repo read registers it.
 */

import { invalidate } from "$app/navigation";

/** The stores the snapshot fills. `meta`, `outbox` and `failed` are not server state. */
export const MIRROR_STORES = [
  "reports",
  "extractions",
  "notes",
  "rules",
  "corrections",
  "contextDoc",
  "entities",
  "entityRelations",
  "entityAppearances",
  "contacts",
  "topics",
] as const;
export type MirrorStore = (typeof MIRROR_STORES)[number];

export type MirrorKey = `mirror:${MirrorStore | "status"}`;

export function mirrorKey(store: MirrorStore | "status"): MirrorKey {
  return `mirror:${store}`;
}

export function isMirrorStore(store: string): store is MirrorStore {
  return (MIRROR_STORES as readonly string[]).includes(store);
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
