/**
 * Reconstructs the Phase 3 gate verdict for extractions written before the columns existed.
 *
 * Without this, `/[date]/triage` would be blank for every report in the archive - including the
 * one that prompted it - and the question "why was that mail not in the briefing" would stay
 * unanswerable for exactly the days it is being asked about.
 *
 * It replays the real rule rather than a second copy of it: `decideGate` is the same function the
 * pipeline runs, and the corroboration bonus is recomputed from the stored extraction JSON, which
 * is fully determined by what is in the database. The one input that is gone is the source trust
 * score *of that morning* - `source_quality` holds today's, and the weekly scoring job has moved
 * it since. So a reconstruction uses 1.0 and stamps `recordedBy: "backfill"`, which the view shows,
 * rather than quietly passing off a plausible number as what happened.
 *
 * `effective_relevance` is deliberately left alone on these rows: it is what the run of the day
 * wrote and what that day's source scores were computed from. The reconstructed figure lives on
 * the verdict instead.
 *
 * Idempotent, and it never overwrites a verdict Phase 3 recorded itself.
 *
 *   bun run scripts/backfill-gate.ts             # every date with an unjudged extraction
 *   bun run scripts/backfill-gate.ts 2026-09-12  # one date
 *   bun run scripts/backfill-gate.ts --force     # redo backfilled rows too, keeping phase3 ones
 */

import { eq, inArray, isNull } from "drizzle-orm";
import { db, extractions, rawItems } from "../src/db";
import { decideGate, type GateDetail } from "../src/pipeline/gate";

const args = process.argv.slice(2);
const force = args.includes("--force");
const requested = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

/**
 * Which dates to touch. Corroboration counts entities across a whole run date, so the unit of
 * work is a day: judging a half-backfilled day from only its unjudged rows would compute the
 * bonus off a partial corpus and produce numbers that never existed.
 */
const targetDates = requested.length > 0
  ? requested
  : (
      await db
        .selectDistinct({ runDate: extractions.runDate })
        .from(extractions)
        .where(force ? undefined : isNull(extractions.gateReason))
    ).map((r) => r.runDate);

if (targetDates.length === 0) {
  console.log("Nothing to backfill - every extraction already carries a verdict.");
  process.exit(0);
}

const rows = await db
  .select({
    id: extractions.id,
    runDate: extractions.runDate,
    rawItemId: extractions.rawItemId,
    extractedJson: extractions.extractedJson,
    relevanceScore: extractions.relevanceScore,
    aiFailed: extractions.aiFailed,
    gateReason: extractions.gateReason,
    gateDetail: extractions.gateDetail,
    sourceType: rawItems.sourceType,
  })
  .from(extractions)
  .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
  .where(inArray(extractions.runDate, targetDates));

/** A verdict the run itself recorded stands: it knew the trust score of the day, this does not. */
const needsWork = (row: (typeof rows)[number]): boolean => {
  if (!row.gateReason) return true;
  return force && (row.gateDetail as GateDetail | null)?.recordedBy !== "phase3";
};

const byDate = new Map<string, typeof rows>();
for (const row of rows) byDate.set(row.runDate, [...(byDate.get(row.runDate) ?? []), row]);

let written = 0;
const tally = new Map<string, number>();

for (const [runDate, dayRows] of [...byDate].sort()) {
  const pending = dayRows.filter(needsWork);
  if (pending.length === 0) continue;

  // entity name -> the raw items of that day carrying it
  const entityToRawItems = new Map<string, Set<string>>();
  const entitiesOf = (row: (typeof rows)[number]): string[] =>
    ((row.extractedJson as { entities?: string[] } | null)?.entities ?? []) as string[];

  for (const row of dayRows) {
    if (!row.rawItemId) continue;
    for (const name of entitiesOf(row)) {
      const key = name.toLowerCase();
      const set = entityToRawItems.get(key) ?? new Set<string>();
      set.add(row.rawItemId);
      entityToRawItems.set(key, set);
    }
  }

  for (const row of pending) {
    const related = new Set(entitiesOf(row).flatMap((n) => [...(entityToRawItems.get(n.toLowerCase()) ?? [])]));

    const decision = decideGate({
      sourceType: row.sourceType,
      aiFailed: row.aiFailed ?? false,
      extractedJson: (row.extractedJson as Record<string, unknown> | null) ?? null,
      relevanceScore: row.relevanceScore,
      trustScore: 1.0,
      sourceCount: related.size > 0 ? related.size : 1,
      recordedBy: "backfill",
    });

    await db
      .update(extractions)
      .set({ gatePassed: decision.passed, gateReason: decision.reason, gateDetail: decision.detail })
      .where(eq(extractions.id, row.id));

    tally.set(decision.reason, (tally.get(decision.reason) ?? 0) + 1);
    written++;
  }

  console.log(`${runDate}: ${pending.length} of ${dayRows.length} reconstructed`);
}

console.log(`\n${written} verdict(s) written:`);
for (const [reason, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${reason.padEnd(24)} ${n}`);

const remaining = await db.select({ id: extractions.id }).from(extractions).where(isNull(extractions.gateReason));
console.log(`${remaining.length} extraction(s) still without a verdict.`);
