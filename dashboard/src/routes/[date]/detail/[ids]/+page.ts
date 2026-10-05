import { isDateKey } from "$pipeline/util/ids";
import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { parseIds } from "#lib/ids.js";
import { extractionsFor, mirrorEmpty } from "#lib/offline/repo.js";

/** Client-rendered and local-first (reads the mirror), same reasoning as `[date]/+page.ts`. */
export const ssr = false;

export const load: PageLoad = async ({ params, depends }) => {
  const { date, ids } = params;
  if (!isDateKey(date)) error(404, "Not found");

  const idList = parseIds(ids);
  if (idList.length === 0) error(400, "No valid item IDs");

  const [items, empty] = await Promise.all([extractionsFor(depends, idList), mirrorEmpty()]);
  // Not a 404 yet: nothing is mirrored at all, and the layout shows the first sync instead.
  if (empty) return { date, ids, items, missing: [] as string[], mirrorEmpty: true };

  // The mirror only holds items a recent report cites, while the source pages link every
  // delivery. The page fetches these live; a load must not wait on the network.
  const have = new Set(items.map((item) => item.id));
  const missing = idList.filter((id) => !have.has(id));

  return { date, ids, items, missing, mirrorEmpty: false };
};
