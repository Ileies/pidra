import type { PageServerLoad } from "./$types";
import { sql } from "$lib/db";
import { parseJsonb } from "$lib/jsonb";
import type { StepAttempt } from "$lib/pipeline";

/**
 * Pipeline run history (D5).
 *
 * `pipeline_runs` had no UI: a successful run was invisible, and a failed one only surfaced on
 * its own date page, and then only if that day had no report. So there was no way to see that a
 * run was getting slower, or that phase 2 had failed three days running.
 *
 * Per-phase timing is not stored - `withRetry` records attempts, not durations - so this shows
 * what the table holds: total duration, status, the failed step and its attempt log, plus the
 * report's token counts joined on the date for the cost trend.
 */

export interface RunRow {
  id: string;
  runDate: string;
  status: string;
  failedStep: string | null;
  stepErrors: StepAttempt[];
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  itemsIncluded: number | null;
}

export const load: PageServerLoad = async () => {
  const rows = await sql()`
    SELECT
      r.id,
      r.run_date::text AS run_date,
      r.status,
      r.failed_step,
      r.step_errors,
      r.started_at,
      r.completed_at,
      r.duration_ms,
      d.tokens_in,
      d.tokens_out,
      d.items_included
    FROM pipeline_runs r
    LEFT JOIN daily_reports d ON d.report_date = r.run_date
    ORDER BY r.started_at DESC
    LIMIT 90
  `;

  const runs: RunRow[] = rows.map((row) => ({
    id: row.id as string,
    runDate: row.run_date as string,
    status: row.status as string,
    failedStep: (row.failed_step as string | null) ?? null,
    stepErrors: parseJsonb<StepAttempt[]>(row.step_errors, []),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    tokensIn: (row.tokens_in as number | null) ?? null,
    tokensOut: (row.tokens_out as number | null) ?? null,
    itemsIncluded: (row.items_included as number | null) ?? null,
  }));

  const completed = runs.filter((run) => run.status === "completed");

  return {
    runs,
    summary: {
      total: runs.length,
      completed: completed.length,
      failed: runs.filter((run) => run.status === "failed").length,
      running: runs.filter((run) => run.status === "running").length,
      medianDurationMs: median(completed.map((run) => run.durationMs).filter((ms): ms is number => ms != null)),
    },
  };
};

/** Median, not mean: one 40-minute question-gate wait should not describe every other run. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}
