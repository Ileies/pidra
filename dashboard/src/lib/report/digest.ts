import { ACTION_META, type QuickAction } from "#lib/report/types.js";

interface DigestInput {
  date: string;
  today: string;
  report: { itemsIncluded: number | null; itemCount: number | null; itemsFiltered: number | null } | null;
  newsGroups: { group: string }[];
  pipelineStatus: string | null;
  ingestFailures: { source: string; kind: string }[];
  openActions: QuickAction[];
}

/** What the assistant is told about the briefing on screen. */
export function buildReportDigest(input: DigestInput): string {
  const { date, today, report, newsGroups, pipelineStatus, ingestFailures, openActions } = input;
  return [
    `Daily briefing for ${date}${date === today ? " (today)" : ""}.`,
    report
      ? `${report.itemsIncluded ?? 0} of ${report.itemCount ?? 0} items in the report, ${report.itemsFiltered ?? 0} filtered out.`
      : "There is no report for this day yet.",
    newsGroups.length > 0 ? `Its News section covers ${newsGroups.map((g) => g.group).join(", ")}.` : "",
    pipelineStatus ? `Last run: ${pipelineStatus}.` : "",
    // So the assistant does not reason about a briefing as if it were complete when it is not.
    ingestFailures.length > 0
      ? `Ingest was incomplete: ${ingestFailures
          .map((f) => `${f.source} (${f.kind})`)
          .join(", ")} never delivered, so anything from them is missing from this briefing.`
      : "",
    openActions.length > 0
      ? `The report offers quick-action buttons the user can tap: ${openActions
          .map((a) => `${ACTION_META[a.preview.kind].verb} "${a.preview.title}"`)
          .join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
