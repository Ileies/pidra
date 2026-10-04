import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import type { StepAttempt } from "#lib/pipeline.js";

/** One `pipeline_runs` row with the report's counts joined on the date, as `/runs` and `/runs/[id]` both show it. */
export interface RunSummary {
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

/** The columns `mapRun` reads, from `pipeline_runs r LEFT JOIN daily_reports d ON d.report_date = r.run_date`. */
export const runColumns = () => sql()`
  r.id, r.run_date::text AS run_date, r.status, r.failed_step, r.step_errors,
  r.started_at, r.completed_at, r.duration_ms,
  d.tokens_in, d.tokens_out, d.items_included`;

const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string).toISOString());
const num = (value: unknown): number | null => (value == null ? null : Number(value));

export function mapRun(row: Record<string, unknown>): RunSummary {
  return {
    id: row.id as string,
    runDate: row.run_date as string,
    status: row.status as string,
    failedStep: (row.failed_step as string | null) ?? null,
    stepErrors: parseJsonb<StepAttempt[]>(row.step_errors, []),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    durationMs: num(row.duration_ms),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    itemsIncluded: num(row.items_included),
  };
}
