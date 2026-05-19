import { db, sourceQuality, sourceDailyScores } from "../db";
import { eq, gte, and, sql as drizzleSql } from "drizzle-orm";

// trustScore = clamp(0.5, 2.0, compositeScore30d / 5)
// 5/10 → 1.0 (neutral), 10/10 → 2.0 (best), 0/10 → 0.5 (worst)
function computeTrustScore(composite30d: number): number {
  return Math.min(2.0, Math.max(0.5, composite30d / 5));
}

export async function runWeeklySourceScoring(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const day7ago = new Date(Date.now() - 7 * 86400_000).toISOString().split("T")[0];
  const day30ago = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];

  const allSources = await db.select().from(sourceQuality);
  console.log(`[WeeklyScoring] Processing ${allSources.length} source(s)`);

  for (const source of allSources) {
    if (source.compositeScore30d == null) continue;

    const trustScore = computeTrustScore(source.compositeScore30d);

    // Compute 7-day composite to determine trend direction
    const recent7d = await db
      .select({ compositeScore: sourceDailyScores.compositeScore, itemsReceived: sourceDailyScores.itemsReceived })
      .from(sourceDailyScores)
      .where(and(eq(sourceDailyScores.sourceName, source.sourceName), gte(sourceDailyScores.runDate, day7ago)));

    const totalWeight7d = recent7d.reduce((s, r) => s + (r.itemsReceived ?? 1), 0);
    const avg7d = totalWeight7d > 0
      ? recent7d.reduce((s, r) => s + (r.compositeScore ?? 0) * (r.itemsReceived ?? 1), 0) / totalWeight7d
      : null;

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
  }
}
