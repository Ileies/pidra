// How far back the daily IMAP ingest reads: from the last completed run, within a floor and a cap.
import { and, desc, eq, lt } from "drizzle-orm";
import { db, pipelineRuns } from "../db";

const DAY = 86_400_000;
/** An outage or skipped days still get covered, up to this far back. */
const MAX_LOOKBACK_DAYS = 3;

/**
 * Pure: from the last completed run's start to now, never shorter than `minDays` (`IMAP_LOOKBACK_DAYS`)
 * and never longer than three days. A fixed "last 24 hours" silently drops the mail of a gap after a
 * delayed or missed run; refetching is safe because `raw_items.message_id` dedupes. Mirrors `newsWindow`.
 */
export function imapSince(now: Date, lastRunStart: Date | null, minDays: number): Date {
  const latest = now.getTime() - minDays * DAY;
  const earliest = Math.min(now.getTime() - MAX_LOOKBACK_DAYS * DAY, latest);
  const from = lastRunStart ? Math.min(Math.max(lastRunStart.getTime(), earliest), latest) : latest;
  return new Date(from);
}

/** `started_at` of the newest completed run of an earlier date; null before the first one. */
export async function lastCompletedRunStart(runDate: string): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.status, "completed"), lt(pipelineRuns.runDate, runDate)))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  return row?.startedAt ? new Date(row.startedAt) : null;
}

/** The `since` for one run's IMAP ingest, computed once so every account shares it. */
export async function imapSinceForRun(runDate: string, now = new Date()): Promise<Date> {
  const minDays = parseInt(process.env.IMAP_LOOKBACK_DAYS ?? "1");
  return imapSince(now, await lastCompletedRunStart(runDate), minDays);
}
