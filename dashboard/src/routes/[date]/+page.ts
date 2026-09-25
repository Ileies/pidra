import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { mirrorEmpty, report, reportDates } from "#lib/offline/repo.js";

/**
 * Client-rendered and local-first. Was `+page.server.ts`
 * querying Postgres directly; offline that meant no HTML and no `__data.json`, so a cached report
 * could be looked at but not rated, searched or re-rendered. Reads the mirror only and never waits
 * for the network: a background sync that changes a report re-runs this load by itself.
 */
export const ssr = false;

function localToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export const load: PageLoad = async ({ params, depends }) => {
  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const [data, dates, empty] = await Promise.all([report(depends, date), reportDates(depends), mirrorEmpty()]);
  const today = localToday();

  const sorted = dates.includes(date) ? dates : [...dates, date].sort((a, b) => b.localeCompare(a));
  const index = sorted.indexOf(date);

  return {
    date,
    today,
    /** Whether today's briefing is in the mirror, so an older day can offer it when it arrives. */
    hasToday: dates.includes(today),
    report: data?.report ?? null,
    // stepErrors is never mirrored (attempt stacks can quote raw content); ErrorCard's `attempts`
    // prop defaults to [].
    // `ingestFailures` is the sanitised digest of the same column - source and kind, no text - and
    // is what the warning above the briefing renders from. A report mirrored before that field
    // existed has none, hence the fallback rather than a required field.
    pipelineRun: data?.pipelineRun ? { ...data.pipelineRun, stepErrors: [] } : null,
    ingestFailures: data?.ingestFailures ?? [],
    structured: data?.structured ?? null,
    reportHtml: data?.reportHtml ?? null,
    ratings: data?.ratings ?? {},
    // Newer dates sort first, so "next" (a later date) is the previous array entry.
    prevDate: sorted[index + 1] ?? null,
    nextDate: index > 0 ? sorted[index - 1] : null,
    mirrorEmpty: empty,
  };
};
