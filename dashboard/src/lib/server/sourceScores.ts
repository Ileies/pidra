import { daysAgo } from "$pipeline/util/time";
import { sql } from "#lib/server/postgres.js";

// Read-only view of `source_daily_scores`, written by the pipeline (`/sources`, online-only).
export interface DailyScore {
  sourceName: string;
  runDate: string;
  itemsReceived: number;
  itemsIncluded: number;
  avgRelevance: number | null;
  avgEffectiveRelevance: number | null;
  includeRate: number | null;
  compositeScore: number | null;
}

/** The last 30 days of per-day scores, newest first: one source's, or every source's. */
export function recentDailyScores(sourceName?: string): Promise<DailyScore[]> {
  const db = sql();
  return db<DailyScore[]>`
    SELECT source_name AS "sourceName", run_date::text AS "runDate",
           items_received AS "itemsReceived", items_included AS "itemsIncluded",
           avg_relevance AS "avgRelevance", avg_effective_relevance AS "avgEffectiveRelevance",
           include_rate AS "includeRate", composite_score AS "compositeScore"
    FROM source_daily_scores
    WHERE run_date >= ${daysAgo(30)} ${sourceName ? db`AND source_name = ${sourceName}` : db``}
    ORDER BY run_date DESC
  `;
}
