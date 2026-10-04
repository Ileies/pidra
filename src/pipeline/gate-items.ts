import { db, type extractions } from "../db";
import { sql } from "drizzle-orm";
import { decideGate, type GateDecision } from "./gate";
import { NEWS_SOURCE_TYPE } from "../news/config";
import { handoffForOrder } from "./section1-handoff";

const PERSIST_CHUNK = 500;

export interface ExtractionWithSource {
  extraction: typeof extractions.$inferSelect;
  sourceName: string | null;
  sourceType: string;
  /** Why this item was or was not handed to synthesis. Persisted before this phase returns. */
  gate: GateDecision;
}

/** One extraction of the run with what the gate needs to know about the item it came from. */
export interface TodaysExtraction {
  extraction: typeof extractions.$inferSelect;
  sourceName: string | null;
  sourceType: string | null;
}

/**
 * Runs the gate on every extraction of the run, with the source's trust score and the
 * corroboration (how many distinct raw items name the same entities) behind each verdict.
 */
export function gateExtractions(rows: TodaysExtraction[], qualityMap: Map<string, number>): ExtractionWithSource[] {
  // A news desk story is not a newsletter's corroboration. The desks return dozens of stories
  // naming the same few countries and leaders, so counting them would lift the bonus on almost
  // every newsletter item that mentions one - a change to the newsletter bar nobody decided.
  const entityToItems = new Map<string, string[]>();
  for (const { extraction, sourceType } of rows) {
    if (sourceType === NEWS_SOURCE_TYPE) continue;
    for (const entity of extraction.extractedJson?.entities ?? []) {
      const key = entity.toLowerCase();
      if (!entityToItems.has(key)) entityToItems.set(key, []);
      entityToItems.get(key)!.push(extraction.id);
    }
  }
  const rawItemOf = new Map(rows.map(({ extraction }) => [extraction.id, extraction.rawItemId]));

  return rows.map(({ extraction, sourceName, sourceType: rawType }) => {
    const entityNames = extraction.extractedJson?.entities ?? [];
    const relatedItemIds = new Set(entityNames.flatMap((e) => entityToItems.get(e.toLowerCase()) ?? []));
    const sourceCount = relatedItemIds.size > 0 ? new Set([...relatedItemIds].map((id) => rawItemOf.get(id))).size : 1;

    const sourceType = rawType ?? "unknown";
    const news = sourceType === NEWS_SOURCE_TYPE;
    const gate = decideGate({
      sourceType,
      aiFailed: extraction.aiFailed ?? false,
      extractedJson: (extraction.extractedJson as Record<string, unknown> | null) ?? null,
      relevanceScore: extraction.relevanceScore,
      // A desk's significance is compared as it stands: a desk has no trust score, and its
      // stories are neither corroborated nor corroborating (see above).
      trustScore: news ? 1 : qualityMap.get(sourceName ?? "") ?? 1.0,
      sourceCount: news ? 1 : sourceCount,
    });

    return { extraction: { ...extraction, effectiveRelevance: gate.effectiveRelevance }, sourceName, sourceType, gate };
  });
}

/**
 * Writes the gate's verdict back onto every extraction of the run, so `/[date]/triage` can say
 * why an item is missing from the briefing instead of only that it is.
 *
 * `effective_relevance` is overwritten on purpose: Phase 2 seeds the column with the raw
 * relevance score as a placeholder, and the number the gate actually compared is this one -
 * trust-weighted and corroborated. Phase 6 reads the column afterwards for the source scores,
 * which means its relevance fallback now matches the real bar rather than approximating it.
 *
 * The phase is wrapped in `withRetry`, so this has to be idempotent, and it is - every attempt
 * writes the same verdict over the same id. One `UPDATE ... FROM (VALUES ...)` per chunk.
 */
export async function persistGate(items: ExtractionWithSource[], newsletterOrder: Map<string, number>): Promise<void> {
  for (let start = 0; start < items.length; start += PERSIST_CHUNK) {
    const rows = items.slice(start, start + PERSIST_CHUNK).map((item) => {
      const order = newsletterOrder.get(item.extraction.id) ?? null;
      return sql`(${item.extraction.id}::uuid, ${item.gate.effectiveRelevance}::real, ${item.gate.passed}::boolean, ${item.gate.reason}::text, ${JSON.stringify(item.gate.detail)}::jsonb, ${order}::integer, ${handoffForOrder(order)}::text)`;
    });
    await db.execute(sql`
      UPDATE extractions AS e SET
        effective_relevance = v.effective_relevance,
        gate_passed = v.gate_passed,
        gate_reason = v.gate_reason,
        gate_detail = v.gate_detail,
        synthesis_order = v.synthesis_order,
        synthesis_handoff = v.synthesis_handoff
      FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, effective_relevance, gate_passed, gate_reason, gate_detail, synthesis_order, synthesis_handoff)
      WHERE e.id = v.id
    `);
  }
}
