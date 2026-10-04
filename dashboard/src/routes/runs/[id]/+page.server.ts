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

  return { run: mapRun(run), steps };
};
