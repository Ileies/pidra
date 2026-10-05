import { daysAgo } from "../../util/time";
import { db, extractions, rawItems, sourceDailyScores, sourceQuality } from "../../db";
import { eq, and, gte, sql as drizzleSql } from "drizzle-orm";
import { NEWSLETTER_THRESHOLD } from "../gate";
import { countsAsIncluded, dailyComposite, neutralRelevance } from "../source-signal";

const avg = (nums: number[]) => nums.reduce((s, v) => s + v, 0) / nums.length;

/**
 * Newsletter sources only. Upserts today's `source_daily_scores` per source and refreshes
 * `source_quality.composite_score_30d` (item-weighted); `trust_score` itself is set weekly by
 * `weekly-source-scoring.ts`. `refsUsable` false means the report carried no resolvable refs.
 */
export async function writeSourceDailyScores(runDate: string, refsUsable: boolean): Promise<void> {
  const rows = await db
    .select({
      sourceName: rawItems.sourceName,
      relevanceScore: extractions.relevanceScore,
      gateReason: extractions.gateReason,
      gateDetail: extractions.gateDetail,
      includedInReport: extractions.includedInReport,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  if (!refsUsable) {
    // No usable anchors this run. Scoring every source at a 0% include rate would punish them
    // for a synthesis formatting failure, so fall back to the old relevance proxy for a day.
    console.warn("[Phase 6] No resolvable report refs - include rate falls back to relevance >= 3");
  }

  // Group by sourceName. Everything here is read at neutral trust (see pipeline/source-signal.ts),
  // so a source is judged by what it sends and not by what the gate already did to it.
  const bySource = new Map<string, { relevances: number[]; neutrals: number[]; included: number }>();
  for (const row of rows) {
    if (!row.sourceName) continue;
    const entry = bySource.get(row.sourceName) ?? { relevances: [], neutrals: [], included: 0 };
    if (row.relevanceScore != null) {
      entry.relevances.push(row.relevanceScore);
      entry.neutrals.push(neutralRelevance(row));
    }
    const included = refsUsable ? countsAsIncluded(row) : neutralRelevance(row) >= NEWSLETTER_THRESHOLD;
    if (included) entry.included += 1;
    bySource.set(row.sourceName, entry);
  }

  for (const [sourceName, { relevances, neutrals, included }] of bySource) {
    const itemsReceived = relevances.length;
    if (itemsReceived === 0) continue;

    const avgRelevance = avg(relevances);
    const avgEffectiveRelevance = avg(neutrals);
    const itemsIncluded = included;
    const includeRate = itemsIncluded / itemsReceived;
    const compositeScore = dailyComposite(avgEffectiveRelevance, includeRate);

    await db
      .insert(sourceDailyScores)
      .values({ sourceName, runDate, itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore })
      .onConflictDoUpdate({
        target: [sourceDailyScores.sourceName, sourceDailyScores.runDate],
        set: { itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore },
      });

    // Recompute rolling 30-day composite for this source
    const thirtyDaysAgo = daysAgo(30);
    const window = await db
      .select({ compositeScore: sourceDailyScores.compositeScore, itemsReceived: sourceDailyScores.itemsReceived })
      .from(sourceDailyScores)
      .where(and(eq(sourceDailyScores.sourceName, sourceName), gte(sourceDailyScores.runDate, thirtyDaysAgo)));

    const totalWeight = window.reduce((s, r) => s + (r.itemsReceived ?? 1), 0);
    const weightedSum = window.reduce((s, r) => s + (r.compositeScore ?? 0) * (r.itemsReceived ?? 1), 0);
    const compositeScore30d = totalWeight > 0 ? weightedSum / totalWeight : null;

    await db
      .insert(sourceQuality)
      .values({ sourceName, compositeScore30d })
      .onConflictDoUpdate({ target: sourceQuality.sourceName, set: { compositeScore30d, updatedAt: drizzleSql`now()` } });
  }
}
