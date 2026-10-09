/**
 * Housekeeping at the start of a pipeline run: a `pipeline_runs` row still `running` hours after it
 * started belongs to a process that died (killed, rebooted, out of memory), so it is closed as failed
 * instead of showing as running on `/runs` forever.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db, pipelineRuns } from "../db";

/** Far longer than any real run takes, so a run still going is never closed under its own feet. */
export const STALE_RUN_HOURS = 6;

/** Closes every run left `running` for more than `STALE_RUN_HOURS`. Returns how many were closed. */
export async function sweepStaleRuns(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUN_HOURS * 3_600_000).toISOString();
  const closed = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      failedStep: "abandoned",
      stepErrors: [{
        step: "abandoned",
        attempt: 1,
        error: `Still running after ${STALE_RUN_HOURS} hours; the process most likely died`,
        ts: now.toISOString(),
      }],
      completedAt: now.toISOString(),
      durationMs: sql`extract(epoch from (${now.toISOString()}::timestamptz - ${pipelineRuns.startedAt})) * 1000`,
    })
    .where(and(eq(pipelineRuns.status, "running"), lt(pipelineRuns.startedAt, cutoff)))
    .returning({ id: pipelineRuns.id });
  if (closed.length > 0) console.warn(`[Pipeline] Closed ${closed.length} abandoned run(s) left running`);
  return closed.length;
}
