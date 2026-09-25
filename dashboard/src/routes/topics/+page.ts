import type { PageLoad } from "./$types";
import { mirrorEmpty, reportDates, topics } from "#lib/offline/repo.js";

/**
 * Active topics (D1), client-rendered and local-first (OFFLINE_PLAN.md §1, H3). Readable offline;
 * resolving or archiving one stays online-only, see `+page.server.ts`.
 *
 * Story continuity is the reason the system compounds over days, and it had no UI at all - the
 * running summaries that make tomorrow's briefing say "UPDATE:" instead of re-explaining a story
 * were invisible.
 *
 * The days list is the window a topic was live in, from `first_seen` to `last_updated`, narrowed
 * to the mirrored days that produced a report, which are also the only reports a link can open.
 * There is no topic-to-report join table, so this is a range rather than a record of appearances,
 * and the UI says so.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [rows, dates, empty] = await Promise.all([topics(depends), reportDates(depends), mirrorEmpty()]);
  return {
    topics: rows.map((topic) => ({
      ...topic,
      days: dates.filter((day) => day >= topic.firstSeen && day <= topic.lastUpdated),
    })),
    mirrorEmpty: empty,
  };
};
