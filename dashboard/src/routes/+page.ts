import type { PageLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { mirrorEmpty, reportDates } from "#lib/offline/repo.js";

/**
 * `/` never waits (OFFLINE_PLAN.md §7, §14.3 H2). Today when today is mirrored, otherwise the newest
 * mirrored date: with the VPN off overnight today's briefing was never fetched, and an empty "no
 * report yet" page when yesterday's is in the mirror is the wrong answer. The first version pulled
 * the whole snapshot here before deciding, which is half of what made a cold start slow. If a
 * background sync brings today's report while yesterday's is open, that page offers it.
 *
 * An empty mirror is the one case with nothing to decide from. The load then returns, the layout
 * shows the first-sync state, and the sync that fills the mirror re-runs this load (`mirror:status`),
 * which then redirects.
 */
export const ssr = false;

export const load: PageLoad = async ({ depends }) => {
  const [dates, empty] = await Promise.all([reportDates(depends), mirrorEmpty()]);
  if (empty) return { mirrorEmpty: true };

  const today = new Date().toLocaleDateString("sv-SE");
  redirect(307, `/${dates.includes(today) ? today : (dates[0] ?? today)}`);
};
