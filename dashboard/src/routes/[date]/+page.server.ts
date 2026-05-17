import type { PageServerLoad, Actions } from "./$types";
import { env } from "$env/dynamic/private";
import { error, fail } from "@sveltejs/kit";
import postgres from "postgres";
import { marked } from "marked";

let _sql: ReturnType<typeof postgres> | null = null;
function sql() {
  if (!_sql) {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    _sql = postgres(env.DATABASE_URL, { max: 5 });
  }
  return _sql;
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
           tokens_in, tokens_out, ai_calls, created_at
    FROM daily_reports
    WHERE report_date = ${date}
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

  const reportHtml = report?.full_report
    ? (marked(report.full_report as string) as string)
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
          createdAt: report.created_at as string | null,
        }
      : null,
    reportHtml,
    prevDate: availableDates[idx + 1] ?? null,
    nextDate: idx > 0 ? availableDates[idx - 1] : null,
    availableDates,
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
