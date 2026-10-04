import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { acknowledgeNotification, runNotificationKey } from "#lib/server/notifications.js";
import { sql } from "#lib/server/postgres.js";
import { mapRun, runColumns, type RunSummary } from "#lib/server/runs.js";

/**
 * Pipeline run history (D5).
 *
 * `pipeline_runs` had no UI: a successful run was invisible, and a failed one only surfaced on
 * its own date page, and then only if that day had no report. So there was no way to see that a
 * run was getting slower, or that phase 2 had failed three days running.
 *
 * This list shows what `pipeline_runs` holds: total duration, status, the failed step and its
 * attempt log, plus the report's token counts joined on the date for the cost trend. Per-step
 * timing and cost live on `/runs/[id]`.
 */

export interface RunRow extends RunSummary {
  /** Failed or degraded, and not yet marked reviewed: the rows the Runs badge counts. */
  unreviewed: boolean;
}

export const load: PageServerLoad = async () => {
  const db = sql();
  const rows = await db`
    SELECT
      ${runColumns()},
      (n.notification_key IS NULL
        AND (r.status = 'failed' OR COALESCE(jsonb_array_length(r.step_errors), 0) > 0)) AS unreviewed
    FROM pipeline_runs r
    LEFT JOIN daily_reports d ON d.report_date = r.run_date
    LEFT JOIN notification_reads n ON n.notification_key = 'run:' || r.id::text
    ORDER BY r.started_at DESC
    LIMIT 90
  `;

  const runs: RunRow[] = rows.map((row) => ({ ...mapRun(row), unreviewed: row.unreviewed === true }));

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

export const actions: Actions = {
  reviewRun: async ({ request }) => {
    const id = (await readForm(request)).text("id");
    if (!isUuid(id)) return fail(400, { error: "Invalid run id." });
    await acknowledgeNotification(runNotificationKey(id));
    return { reviewedRun: id };
  },
};

/** Median, not mean: one 40-minute question-gate wait should not describe every other run. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}
