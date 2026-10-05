import { utcDay, daysAgo } from "../util/time";
import { db, sourceQuality, sourceDailyScores } from "../db";
import { eq, gte, sql as drizzleSql } from "drizzle-orm";
import { trustComposite, trustFromComposite } from "./source-signal";

export async function runWeeklySourceScoring(): Promise<void> {
  const today = utcDay();

  const [allSources, recentScores] = await Promise.all([
    db.select().from(sourceQuality),
    db
      .select({
        sourceName: sourceDailyScores.sourceName,
        compositeScore: sourceDailyScores.compositeScore,
        itemsReceived: sourceDailyScores.itemsReceived,
      })
      .from(sourceDailyScores)
      .where(gte(sourceDailyScores.runDate, daysAgo(7))),
  ]);
  console.log(`[WeeklyScoring] Processing ${allSources.length} source(s)`);

  const bySource = new Map<string, typeof recentScores>();
  for (const row of recentScores) {
    const rows = bySource.get(row.sourceName);
    if (rows) rows.push(row);
    else bySource.set(row.sourceName, [row]);
  }

  await Promise.all(allSources.map(async (source) => {
    if (source.compositeScore30d == null) return;

    // Compute 7-day composite to determine trend direction
    const recent7d = bySource.get(source.sourceName) ?? [];
    const totalWeight7d = recent7d.reduce((s, r) => s + (r.itemsReceived ?? 1), 0);
    const avg7d = totalWeight7d > 0
      ? recent7d.reduce((s, r) => s + (r.compositeScore ?? 0) * (r.itemsReceived ?? 1), 0) / totalWeight7d
      : null;

    const trustScore = trustFromComposite(trustComposite(source.compositeScore30d, avg7d, totalWeight7d));

    let qualityTrend = source.qualityTrend ?? "stable";
    let lastQualityShift = source.lastQualityShift;
    const prevTrend = qualityTrend;

    if (avg7d != null) {
      const diff = avg7d - source.compositeScore30d;
      if (diff > 0.5) qualityTrend = "improving";
      else if (diff < -0.5) qualityTrend = "declining";
      else qualityTrend = "stable";
    }

    if (qualityTrend !== prevTrend) lastQualityShift = today;

    await db
      .update(sourceQuality)
      .set({ trustScore, qualityTrend, lastQualityShift, updatedAt: drizzleSql`now()` })
      .where(eq(sourceQuality.sourceName, source.sourceName));

    console.log(`[WeeklyScoring] ${source.sourceName}: trustScore=${trustScore.toFixed(2)}, trend=${qualityTrend}`);
  }));
}
