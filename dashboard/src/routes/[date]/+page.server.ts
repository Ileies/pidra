import type { PageServerLoad, Actions } from "./$types";
import { error, fail } from "@sveltejs/kit";
import { renderMarkdown } from "$lib/markdown";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";
import { rateExtraction, UUID_RE } from "$lib/server/extractions";
import type { ReportJson, Urgency } from "$lib/report/types";

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

function localToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export const load: PageServerLoad = async ({ params }) => {
  const { date } = params;
  // `[date]` is a root-level dynamic segment, so it swallows every unmatched single-segment
  // path - including the /favicon.ico every browser requests unprompted. Those are missing
  // resources, not bad requests, and a 400 in the network tab reads like an app failure.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(404, "Not found");

  const db = sql();

  // Four independent queries, so they go together. Prev and next are scalars now: the page used
  // to fetch 60 dates and serialise all of them to a client that never read them (S8, X3, E7).
  const [[report], [pipelineRun], [prev], [next]] = await Promise.all([
    db`
      SELECT report_date, full_report, report_json, short_summary,
             item_count, items_included, items_filtered,
             tokens_in, tokens_out, ai_calls, web_searches_run, created_at
      FROM daily_reports
      WHERE report_date = ${date}
    `,
    db`
      SELECT status, failed_step, step_errors, started_at, completed_at, duration_ms
      FROM pipeline_runs
      WHERE run_date = ${date}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    db`SELECT report_date::text AS report_date FROM daily_reports WHERE report_date < ${date} ORDER BY report_date DESC LIMIT 1`,
    db`SELECT report_date::text AS report_date FROM daily_reports WHERE report_date > ${date} ORDER BY report_date ASC LIMIT 1`,
  ]);

  const fullReport = (report?.full_report as string | null) ?? null;
  const reportJson = report ? parseJsonb<ReportJson | null>(report.report_json, null) : null;

  // A ref that points at nothing is worse than no ref, so every id is checked against a real
  // extraction before it becomes a link or a rating control.
  let validIds = new Set<string>();
  const candidateIds = reportJson
    ? [
        ...new Set([
          ...reportJson.personal.flatMap((group) => group.entries.flatMap((entry) => entry.refIds)),
          ...reportJson.intel.flatMap((group) => group.entries.flatMap((entry) => entry.refIds)),
          ...reportJson.alsoNoted.flatMap((entry) => entry.refIds),
        ]),
      ]
    : fullReport
      ? extractRefsIds(fullReport)
      : [];

  if (candidateIds.length > 0) {
    const rows = await db`SELECT id::text FROM extractions WHERE id::text = ANY(${candidateIds})`;
    validIds = new Set(rows.map((row) => row.id as string));
  }

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
  const reportHtml =
    !structured && fullReport ? injectDetailLinks(renderMarkdown(fullReport), date, validIds) : null;

  // Ratings for everything the report anchors, so the inline +/- (C4) starts in the right state.
  let ratings: Record<string, string> = {};
  if (validIds.size > 0) {
    const rows = await db`
      SELECT extraction_id::text AS extraction_id, event_type FROM feedback_events
      WHERE extraction_id::text = ANY(${[...validIds]})
      AND event_type IN ('explicit_plus', 'explicit_minus')
    `;
    ratings = Object.fromEntries(
      (rows as unknown as { extraction_id: string; event_type: string }[]).map((row) => [
        row.extraction_id,
        row.event_type,
      ]),
    );
  }

  return {
    date,
    today: localToday(),
    report: report
      ? {
          shortSummary: report.short_summary as string | null,
          itemCount: report.item_count as number | null,
          itemsIncluded: report.items_included as number | null,
          itemsFiltered: report.items_filtered as number | null,
          tokensIn: report.tokens_in as number | null,
          tokensOut: report.tokens_out as number | null,
          aiCalls: report.ai_calls as number | null,
          webSearchesRun: report.web_searches_run as number | null,
          createdAt: report.created_at as string | null,
        }
      : null,
    pipelineRun: pipelineRun
      ? {
          status: pipelineRun.status as "running" | "completed" | "failed",
          failedStep: pipelineRun.failed_step as string | null,
          stepErrors: parseJsonb<Array<{
            step: string;
            attempt: number;
            error: string;
            stack?: string;
            ts: string;
          }>>(pipelineRun.step_errors, []),
          startedAt: pipelineRun.started_at as string | null,
          completedAt: pipelineRun.completed_at as string | null,
          durationMs: pipelineRun.duration_ms as number | null,
        }
      : null,
    structured,
    reportHtml,
    ratings,
    prevDate: (prev?.report_date as string | undefined) ?? null,
    nextDate: (next?.report_date as string | undefined) ?? null,
  };
};

export const actions: Actions = {
  runPipeline: async () => {
    try {
      const res = await fetch("http://localhost:4000/api/pipeline/run", { method: "POST" });
      if (!res.ok) return fail(502, { error: "The skills bridge returned an error." });
      return { triggered: true };
    } catch {
      return fail(503, { error: "The skills bridge is not running." });
    }
  },

  /**
   * Rating from inside the report (C4). `feedback_events` only filled up if the reader took a
   * two-click detour to the detail page, which starved the relevance calibration loop.
   */
  rate: async ({ request }) => {
    const data = await request.formData();
    const extractionId = (data.get("extraction_id") as string | null)?.trim();
    const signal = data.get("signal") as string | null;

    if (!extractionId || !UUID_RE.test(extractionId)) return fail(400, { error: "Invalid extraction id" });
    if (signal !== "1" && signal !== "-1") return fail(400, { error: "Invalid signal" });

    return { rated: extractionId, eventType: await rateExtraction(extractionId, signal) };
  },
};
