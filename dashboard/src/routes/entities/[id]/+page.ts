import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { UUID_RE } from "#lib/ids.js";
import { entity, mirrorEmpty, reportDates } from "#lib/offline/repo.js";

/**
 * `/entities/[id]`: mirrored and client-only. Returns the entity plus its `entity_appearances`
 * timeline, each flagged `hasReport` when that day is in the mirror. The Watch write is the `watch`
 * action in `+page.server.ts` (online-only).
 */
export const ssr = false;

export const load: PageLoad = async ({ params, depends }) => {
  const { id } = params;
  if (!UUID_RE.test(id)) error(404, "Not found");

  const [found, dates, empty] = await Promise.all([entity(depends, id), reportDates(depends), mirrorEmpty()]);
  // Not a 404 yet: nothing is mirrored at all, and the layout shows the first sync instead.
  if (empty) return { mirrorEmpty: true as const };
  if (!found) error(404, "Entity not found");

  // The timeline links a day only where there is a report to open, which is the mirrored window:
  // appearances are mirrored for that same window, so the two cover the same days.
  const mirrored = new Set(dates);
  return {
    ...found,
    appearances: found.appearances.map((a) => ({ ...a, hasReport: !!a.reportDate && mirrored.has(a.reportDate) })),
    mirrorEmpty: false as const,
  };
};
