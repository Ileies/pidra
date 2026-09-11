import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";

/**
 * Live pipeline status for one day (C7).
 *
 * The report page used to say "reload the page in a few minutes" and "reload in ~5 min" while
 * /context-builder, in the same codebase, already polled and drew progress bars. This is what
 * the report polls instead, so the briefing appears when it is ready.
 *
 * `hasReport` is the signal the page actually waits on: a run can be marked completed a moment
 * before the row is readable, and it is the report the reader wants, not the run.
 */
export const GET: RequestHandler = async ({ url }) => {
  const date = url.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Invalid date" }, { status: 400 });

  const db = sql();
  const [[run], [report]] = await Promise.all([
    db`
      SELECT status, failed_step, step_errors, started_at, duration_ms
      FROM pipeline_runs
      WHERE run_date = ${date}
      ORDER BY started_at DESC
      LIMIT 1
    `,
    db`SELECT 1 AS present FROM daily_reports WHERE report_date = ${date}`,
  ]);

  return json({
    hasReport: !!report,
    run: run
      ? {
          status: run.status as string,
          failedStep: (run.failed_step as string | null) ?? null,
          stepErrors: parseJsonb<unknown[]>(run.step_errors, []),
          startedAt: run.started_at as string | null,
          durationMs: (run.duration_ms as number | null) ?? null,
        }
      : null,
  });
};
