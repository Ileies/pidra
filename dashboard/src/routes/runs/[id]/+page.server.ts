import { isUuid } from "$pipeline/util/ids";
import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { mapRun, runColumns } from "#lib/server/runs.js";
import type { StepRow } from "#lib/runTrace.js";

/**
 * One pipeline run, broken down by step (`pipeline_run_steps`, written by `src/util/trace.ts`).
 *
 * Runs from before 2026-10-01 have no step rows: the page then shows what `pipeline_runs` and the
 * report hold (total time, status, token counts) and says so, instead of drawing an empty graph.
 * Online-only. `mapRun`/`runColumns` come from `$lib/server/runs.ts`; the page builds the span tree
 * with `$lib/runTrace.ts`.
 */

export const load: PageServerLoad = async ({ params }) => {
  if (!isUuid(params.id)) error(404, "No such run");

  const [runRows, stepRows] = await Promise.all([
    sql()`
      SELECT ${runColumns()}
      FROM pipeline_runs r
      LEFT JOIN daily_reports d ON d.report_date = r.run_date
      WHERE r.id = ${params.id}
    `,
    sql()`
      SELECT
        id, parent_id, step, attempt, status, started_at, ended_at, duration_ms,
        tokens_in, tokens_out, ai_calls, search_calls, flex_retries, detail
      FROM pipeline_run_steps
      WHERE run_id = ${params.id}
      ORDER BY started_at, id
    `,
  ]);

  const run = runRows[0];
  if (!run) error(404, "No such run");

  const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string).toISOString());

  const steps: StepRow[] = stepRows.map((row) => ({
    id: row.id as string,
    parentId: (row.parent_id as string | null) ?? null,
    step: row.step as string,
    attempt: Number(row.attempt),
    status: row.status as string,
    startedAt: iso(row.started_at)!,
    endedAt: iso(row.ended_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    aiCalls: Number(row.ai_calls),
    searchCalls: Number(row.search_calls),
    flexRetries: Number(row.flex_retries),
    detail: parseJsonb<Record<string, unknown> | null>(row.detail, null),
  }));

  return { run: mapRun(run), steps, jev: await jevSummary(params.id) };
};

export interface JevTaskSummary {
  task: string;
  mode: string;
  calls: number;
  failures: number;
  /** Error codes seen, most frequent first. */
  errorCodes: string[];
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  influenced: number;
}

/**
 * Jev calls from the evaluation ledger (`jev_decisions`), per task and mode. Kept apart from the
 * run's own token counts on purpose: those mix other providers. Empty until the table exists or the
 * run made no Jev call; a missing table must not take the page down.
 */
async function jevSummary(runId: string): Promise<JevTaskSummary[]> {
  try {
    const rows = await sql()`
      SELECT
        task, mode,
        count(*)::int AS calls,
        count(*) FILTER (WHERE status = 'error')::int AS failures,
        COALESCE(sum(tokens_in), 0)::int AS tokens_in,
        COALESCE(sum(tokens_out), 0)::int AS tokens_out,
        round(avg(latency_ms))::int AS avg_latency_ms,
        max(latency_ms)::int AS max_latency_ms,
        count(*) FILTER (WHERE influenced_report)::int AS influenced,
        COALESCE(array_agg(error_code ORDER BY error_code) FILTER (WHERE error_code IS NOT NULL), '{}') AS error_codes
      FROM jev_decisions
      WHERE run_id = ${runId}
      GROUP BY task, mode
      ORDER BY task, mode
    `;
    return rows.map((row) => {
      const counts = new Map<string, number>();
      for (const code of row.error_codes as string[]) counts.set(code, (counts.get(code) ?? 0) + 1);
      return {
        task: row.task as string,
        mode: row.mode as string,
        calls: Number(row.calls),
        failures: Number(row.failures),
        errorCodes: [...counts].sort((a, b) => b[1] - a[1]).map(([code]) => code),
        tokensIn: Number(row.tokens_in),
        tokensOut: Number(row.tokens_out),
        avgLatencyMs: Number(row.avg_latency_ms),
        maxLatencyMs: Number(row.max_latency_ms),
        influenced: Number(row.influenced),
      };
    });
  } catch {
    return [];
  }
}
