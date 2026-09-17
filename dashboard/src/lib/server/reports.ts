/**
 * Rendering a report's markdown/JSON into sanitised HTML, shared between the live page and the
 * offline snapshot endpoint (OFFLINE_PLAN.md §5: "reuses the existing server helpers rather than
 * re-querying"). If these drifted into two implementations, the offline reader would eventually
 * see different rendering than the online one for the same report.
 */

import { renderMarkdown } from "#lib/markdown.js";
import { sql } from "#lib/db.js";
import type { ReportJson, Urgency } from "#lib/report/types.js";

/** One entry of the report, ready to render: sanitised HTML plus the refs behind it. */
export interface RenderedEntry {
  html: string;
  /** Only ids that resolve to a real extraction; the rest would be dead links. */
  refIds: string[];
}

export interface RenderedReport {
  personal: { urgency: Urgency; entries: RenderedEntry[] }[];
  intel: { domain: string; entries: RenderedEntry[] }[];
  alsoNoted: RenderedEntry[];
}

function extractRefsIds(markdown: string): string[] {
  const ids: string[] = [];
  const re = /<!--refs:([\w,\-]+)-->/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    for (const id of match[1].split(",")) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Fallback path only: turns the refs comments in the raw markdown into deep links. */
function injectDetailLinks(html: string, date: string, validIds: Set<string>): string {
  return html.replace(/<!--refs:([\w,\-]+)-->/g, (_, ids) => {
    const filtered = ids.split(",").filter((id: string) => validIds.has(id));
    if (filtered.length === 0) return "";
    return `<a href="/${date}/detail/${filtered.join(",")}" class="more-on-this">More on this</a>`;
  });
}

/** Every extraction id a report's structured JSON or raw markdown points at, before validity is
 *  checked against a real row. */
export function collectRefIds(reportJson: ReportJson | null, fullReport: string | null): string[] {
  if (reportJson) {
    return [
      ...new Set([
        ...reportJson.personal.flatMap((group) => group.entries.flatMap((entry) => entry.refIds)),
        ...reportJson.intel.flatMap((group) => group.entries.flatMap((entry) => entry.refIds)),
        ...reportJson.alsoNoted.flatMap((entry) => entry.refIds),
      ]),
    ];
  }
  return fullReport ? extractRefsIds(fullReport) : [];
}

/** Which candidate ids resolve to a real extraction row, in one query for however many were
 *  collected - the snapshot endpoint validates refs across every mirrored report date at once
 *  rather than one round trip per date. */
export async function resolveValidIds(candidateIds: string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await sql()`SELECT id::text FROM extractions WHERE id::text = ANY(${candidateIds})`;
  return new Set(rows.map((row) => row.id as string));
}

/** Renders a report's markdown/JSON into sanitised HTML plus the refs behind it. A ref that points
 *  at nothing is worse than no ref, so ids are filtered against `validIds` before they become a
 *  link or a rating control. */
export function renderReport(params: {
  fullReport: string | null;
  reportJson: ReportJson | null;
  date: string;
  validIds: Set<string>;
}): { structured: RenderedReport | null; reportHtml: string | null } {
  const { fullReport, reportJson, date, validIds } = params;

  const render = (entry: { md: string; refIds: string[] }): RenderedEntry => ({
    html: renderMarkdown(entry.md),
    refIds: entry.refIds.filter((id) => validIds.has(id)),
  });

  const structured: RenderedReport | null = reportJson
    ? {
        personal: reportJson.personal.map((group) => ({ urgency: group.urgency, entries: group.entries.map(render) })),
        intel: reportJson.intel.map((group) => ({ domain: group.domain, entries: group.entries.map(render) })),
        alsoNoted: reportJson.alsoNoted.map(render),
      }
    : null;

  // Fallback: the parser found no section headings, or this row predates the column. Render the
  // markdown exactly as before, so a prompt drift degrades the layout instead of emptying it.
  const reportHtml = !structured && fullReport ? injectDetailLinks(renderMarkdown(fullReport), date, validIds) : null;

  return { structured, reportHtml };
}
