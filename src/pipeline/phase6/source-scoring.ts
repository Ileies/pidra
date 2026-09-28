import { db, extractions, rawItems, sourceDailyScores, sourceQuality } from "../../db";
import { eq, and, gte, sql as drizzleSql } from "drizzle-orm";

const avg = (nums: number[]) => nums.reduce((s, v) => s + v, 0) / nums.length;

export async function writeSourceDailyScores(runDate: string, refsUsable: boolean): Promise<void> {
  // Join extractions → raw_items for today, only newsletters with a sourceName
  const rows = await db
    .select({
      sourceName: rawItems.sourceName,
      relevanceScore: extractions.relevanceScore,
      effectiveRelevance: extractions.effectiveRelevance,
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

  // Group by sourceName
  const bySource = new Map<string, { relevances: number[]; effectives: number[]; included: number }>();
  for (const row of rows) {
    if (!row.sourceName) continue;
    const entry = bySource.get(row.sourceName) ?? { relevances: [], effectives: [], included: 0 };
    if (row.relevanceScore != null) entry.relevances.push(row.relevanceScore);
    if (row.effectiveRelevance != null) entry.effectives.push(row.effectiveRelevance);
    const included = refsUsable ? row.includedInReport === true : (row.effectiveRelevance ?? 0) >= 3;
    if (included) entry.included += 1;
    bySource.set(row.sourceName, entry);
  }

  for (const [sourceName, { relevances, effectives, included }] of bySource) {
    const itemsReceived = relevances.length;
    if (itemsReceived === 0) continue;

    const avgRelevance = avg(relevances);
    const avgEffectiveRelevance = effectives.length ? avg(effectives) : avgRelevance;
    const itemsIncluded = included;
    const includeRate = itemsIncluded / itemsReceived;
    // composite 0–10: quality-weighted (7pts) + breadth signal (3pts)
    const compositeScore = Math.min(10, (avgEffectiveRelevance / 5) * 7 + includeRate * 3);

    await db
      .insert(sourceDailyScores)
      .values({ sourceName, runDate, itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore })
      .onConflictDoUpdate({
        target: [sourceDailyScores.sourceName, sourceDailyScores.runDate],
        set: { itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore },
      });

    // Recompute rolling 30-day composite for this source
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
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
