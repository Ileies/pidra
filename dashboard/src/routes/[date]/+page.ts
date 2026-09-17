import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { report, reportDates } from "#lib/offline/repo.js";

/**
 * Client-rendered and local-first (OFFLINE_PLAN.md O2, decision 1). Was `+page.server.ts` querying
 * Postgres directly; offline that meant no HTML and no `__data.json`, so a cached report could be
 * looked at but not rated, searched or re-rendered. `repo.report()` always resolves from the
 * mirror, refreshed by a network pull first when one is reachable.
 */
export const ssr = false;

function localToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export const load: PageLoad = async ({ params }) => {
  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const [{ data, source, syncedAt }, dates] = await Promise.all([report(date), reportDates()]);

  const sorted = dates.includes(date) ? dates : [...dates, date].sort((a, b) => b.localeCompare(a));
  const index = sorted.indexOf(date);

  return {
    date,
    today: localToday(),
    report: data?.report ?? null,
    // stepErrors is never mirrored (OFFLINE_PLAN.md §4); ErrorCard's `attempts` prop defaults to [].
    pipelineRun: data?.pipelineRun ? { ...data.pipelineRun, stepErrors: [] } : null,
    structured: data?.structured ?? null,
    reportHtml: data?.reportHtml ?? null,
    ratings: data?.ratings ?? {},
    // Newer dates sort first, so "next" (a later date) is the previous array entry.
    prevDate: sorted[index + 1] ?? null,
    nextDate: index > 0 ? sorted[index - 1] : null,
    source,
    syncedAt,
  };
};
