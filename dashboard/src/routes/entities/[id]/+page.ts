import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { UUID_RE } from "#lib/ids.js";
import { entity, mirrorEmpty, reportDates } from "#lib/offline/repo.js";

/**
 * Entity detail (D2), client-rendered and local-first.
 *
 * /entities was a flat table with no detail page, so `entity_relations` and `entity_appearances`
 * - the two tables that make it a graph rather than a list - had no UI at all. This is also the
 * natural target for a row tap on a phone, where most of the table's columns are hidden anyway.
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
