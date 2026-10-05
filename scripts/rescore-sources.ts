/**
 * Rebuilds `source_daily_scores` and every trust score from the stored extractions, with the
 * current formulas (`src/pipeline/source-signal.ts`). Run it once after those formulas change:
 * the history they replace was computed from trust-weighted numbers, so it would otherwise keep
 * dragging each source's rolling average until it aged out.
 *
 *   bun run --env-file=.env scripts/rescore-sources.ts           # dry run: lists the dates, writes nothing
 *   bun run --env-file=.env scripts/rescore-sources.ts --apply   # write, then print old -> new trust per source
 */
import { db, extractions, rawItems, sourceQuality } from "../src/db";
import { and, eq, gte } from "drizzle-orm";
import { daysAgo } from "../src/util/time";
import { writeSourceDailyScores } from "../src/pipeline/phase6/source-scoring";
import { runWeeklySourceScoring } from "../src/pipeline/weekly-source-scoring";

const apply = process.argv.includes("--apply");

const before = new Map((await db.select().from(sourceQuality)).map((s) => [s.sourceName, s.trustScore ?? 1]));

const dates = (
  await db
    .selectDistinct({ runDate: extractions.runDate })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(rawItems.sourceType, "newsletter"), gte(extractions.runDate, daysAgo(30))))
).map((r) => r.runDate).sort();

if (!apply) {
  console.log(`Would rescore ${dates.length} run date(s) from ${dates[0]} to ${dates.at(-1)}. Pass --apply to write.`);
  process.exit(0);
}

for (const date of dates) await writeSourceDailyScores(date, true);
await runWeeklySourceScoring();

const after = await db.select().from(sourceQuality);
for (const s of after.sort((a, b) => (a.trustScore ?? 1) - (b.trustScore ?? 1))) {
  const was = before.get(s.sourceName) ?? 1;
  const now = s.trustScore ?? 1;
  console.log(`${s.sourceName.padEnd(40)} ${was.toFixed(2)} -> ${now.toFixed(2)}${Math.abs(now - was) >= 0.15 ? "  *" : ""}`);
}
process.exit(0);
