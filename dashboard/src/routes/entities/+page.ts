import type { PageLoad } from "./$types";
import { entities, mirrorEmpty } from "#lib/offline/repo.js";

/**
 * `/entities`: mirrored (IndexedDB via `$lib/offline/repo`), client-only. The whole table is a few
 * hundred rows, so the load returns all of it and the page filters, which means a filter change
 * re-renders instead of re-running this load. `mirrorEmpty` makes the layout show first-sync.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, empty] = await Promise.all([entities(depends), mirrorEmpty()]);
  return { entities: rows, mirrorEmpty: empty };
};
