import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { parseIds } from "#lib/ids.js";
import { extractionsFor, mirrorEmpty } from "#lib/offline/repo.js";

/** Client-rendered and local-first. The read side moved off
 *  `+page.server.ts`; see `[date]/+page.ts` for the reasoning, identical here. */
export const ssr = false;

export const load: PageLoad = async ({ params, depends }) => {
  const { date, ids } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const idList = parseIds(ids);
  if (idList.length === 0) error(400, "No valid item IDs");

  const [items, empty] = await Promise.all([extractionsFor(depends, idList), mirrorEmpty()]);
  // Not a 404 yet: nothing is mirrored at all, and the layout shows the first sync instead.
  if (empty) return { date, ids, items, mirrorEmpty: true };
  if (items.length === 0) error(404, "Items not found");

  return { date, ids, items, mirrorEmpty: false };
};
