import type { PageServerLoad, Actions } from "./$types";
import { error, fail } from "@sveltejs/kit";
import { marked } from "marked";
import { sql } from "$lib/db";

function extractRefsIds(markdown: string): string[] {
  const ids: string[] = [];
  const re = /<!--refs:([\w,\-]+)-->/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    for (const id of m[1].split(",")) ids.push(id);
  }
  return [...new Set(ids)];
}

function injectDetailLinks(html: string, date: string, validIds: Set<string>): string {
  return html.replace(/<!--refs:([\w,\-]+)-->/g, (_, ids) => {
    const filtered = ids.split(",").filter((id: string) => validIds.has(id));
    if (filtered.length === 0) return "";
    return `<a href="/${date}/detail/${filtered.join(",")}" class="mehr-dazu">Mehr dazu</a>`;
  });
}

function toDateStr(v: unknown): string {
  if (v instanceof Date) return v.toLocaleDateString("sv-SE");
  return String(v).slice(0, 10);
}

function localToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export const load: PageServerLoad = async ({ params }) => {
  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, "Invalid date format");

  const db = sql();

  const [report] = await db`
    SELECT report_date, full_report, short_summary,
           item_count, items_included, items_filtered,
           tokens_in, tokens_out, ai_calls, web_searches_run, created_at
    FROM daily_reports
    WHERE report_date = ${date}
  `;

  const [pendingGate] = await db`
    SELECT 1 FROM question_gate_sessions WHERE status = 'pending' LIMIT 1
  `;

  const [pipelineRun] = await db`
    SELECT status, failed_step, step_errors, started_at, completed_at, duration_ms
    FROM pipeline_runs
    WHERE run_date = ${date}
    ORDER BY started_at DESC
    LIMIT 1
  `;

  const dates = await db`
    SELECT report_date
    FROM daily_reports
    ORDER BY report_date DESC
    LIMIT 60
  `;

  const availableDates = dates.map((r) => toDateStr(r.report_date));
  const today = localToday();
  const idx = availableDates.indexOf(date);

  let validIds = new Set<string>();
  if (report?.full_report) {
    const allIds = extractRefsIds(report.full_report as string);
    if (allIds.length > 0) {
      const rows = await db`SELECT id::text FROM extractions WHERE id::text = ANY(${allIds})`;
      validIds = new Set(rows.map((r) => r.id as string));
    }
  }

  const reportHtml = report?.full_report
    ? injectDetailLinks(marked(report.full_report as string) as string, date, validIds)
    : null;

  return {
    date,
    today,
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
          stepErrors: (pipelineRun.step_errors ?? []) as Array<{
            step: string;
            attempt: number;
            error: string;
            stack?: string;
            ts: string;
          }>,
          startedAt: pipelineRun.started_at as string | null,
          completedAt: pipelineRun.completed_at as string | null,
          durationMs: pipelineRun.duration_ms as number | null,
        }
      : null,
    reportHtml,
    prevDate: availableDates[idx + 1] ?? null,
    nextDate: idx > 0 ? availableDates[idx - 1] : null,
    availableDates,
    hasPendingQuestions: !!pendingGate,
  };
};

export const actions: Actions = {
  runPipeline: async ({ params }) => {
    const { date } = params;
    try {
      const res = await fetch("http://localhost:4000/api/pipeline/run", {
        method: "POST",
      });
      if (!res.ok) return fail(502, { error: "Server error" });
      return { triggered: true, date };
    } catch {
      return fail(503, { error: "Skills bridge not running" });
    }
  },
};
