import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { setSourceActive } from "#lib/server/sources.js";

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

export interface SourceRow {
  sourceName: string;
  isActive: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  trustScore: number | null;
  qualityTrend: string | null;
  compositeScore30d: number | null;
  unsubscribeUrl: string | null;
  dailyScores: DailyScore[];
}

export const load: PageServerLoad = async () => {
  const db = sql();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
  const [qualityRows, dailyRows] = await Promise.all([
    db`
      SELECT source_name AS "sourceName", is_active AS "isActive",
             disabled_at::text AS "disabledAt", disabled_reason AS "disabledReason",
             trust_score AS "trustScore", quality_trend AS "qualityTrend",
             composite_score_30d AS "compositeScore30d", unsubscribe_url AS "unsubscribeUrl"
      FROM source_quality
      ORDER BY composite_score_30d DESC NULLS LAST
    `,
    db`
      SELECT source_name AS "sourceName", run_date::text AS "runDate",
             items_received AS "itemsReceived", items_included AS "itemsIncluded",
             avg_relevance AS "avgRelevance", avg_effective_relevance AS "avgEffectiveRelevance",
             include_rate AS "includeRate", composite_score AS "compositeScore"
      FROM source_daily_scores
      WHERE run_date >= ${thirtyDaysAgo}
      ORDER BY run_date DESC
    `,
  ]);

  const dailyBySource = new Map<string, DailyScore[]>();
  for (const row of dailyRows as unknown as DailyScore[]) {
    const scores = dailyBySource.get(row.sourceName) ?? [];
    scores.push(row);
    dailyBySource.set(row.sourceName, scores);
  }

  const sources: SourceRow[] = (qualityRows as unknown as Omit<SourceRow, "dailyScores">[]).map((row) => ({
    ...row,
    dailyScores: (dailyBySource.get(row.sourceName) ?? []).slice(0, 30),
  }));
  return { sources };
};

export const actions: Actions = {
  toggle: async ({ request }) => {
    const data = await request.formData();
    const sourceName = data.get("sourceName") as string;
    const isActive = data.get("isActive") === "true";
    const reason = (data.get("reason") as string) || undefined;

    if (!sourceName) return fail(400, { error: "sourceName required" });

    try {
      await setSourceActive(sourceName, isActive, reason);
    } catch (err) {
      console.error("source toggle failed", err);
      return fail(500, { error: "Could not update the source." });
    }
    return { ok: true };
  },
};
