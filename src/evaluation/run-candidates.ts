/**
 * Freezes one run's candidate trail into `run_candidates` after Phase 6: for every newsletter claim and
 * news story of the run date, the gate verdict, handoff, News editor position, citation and outcome.
 * Idempotent per run and extraction; a ledger failure is warned and never reaches the pipeline.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, extractions, rawItems, runCandidates } from "../db";
import { errMessage } from "../util/text";
import { ordered } from "../news/format";
import type { NewsExtraction } from "../news/validate";
import { candidateOutcome } from "./baseline";

const TYPES = ["newsletter", "web_news"] as const;

/** Returns the number of rows written, 0 when there was nothing to record or the write failed. */
export async function recordRunCandidates(runId: string, runDate: string): Promise<number> {
  try {
    const rows = await db.select({
      id: extractions.id,
      rawItemId: extractions.rawItemId,
      sourceType: rawItems.sourceType,
      sourceName: rawItems.sourceName,
      json: extractions.extractedJson,
      aiFailed: extractions.aiFailed,
      relevanceScore: extractions.relevanceScore,
      effectiveRelevance: extractions.effectiveRelevance,
      novelty: extractions.novelty,
      gatePassed: extractions.gatePassed,
      gateReason: extractions.gateReason,
      gateDetail: extractions.gateDetail,
      synthesisHandoff: extractions.synthesisHandoff,
      synthesisOrder: extractions.synthesisOrder,
      includedInReport: extractions.includedInReport,
    }).from(extractions).innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
      .where(and(eq(extractions.runDate, runDate), inArray(rawItems.sourceType, [...TYPES])));
    if (rows.length === 0) return 0;

    // The same ordering the editor input gets, so position here is what the editor saw.
    const editorOrder = new Map(
      ordered(rows.filter((r) => r.sourceType === "web_news" && r.gatePassed === true)
        .map((r) => ({ id: r.id, story: r.json as NewsExtraction })))
        .map((item, index) => [item.id, index + 1] as const),
    );

    const values = rows.map((r) => {
      const sourceType = r.sourceType as (typeof TYPES)[number];
      const included = r.includedInReport === true;
      return {
        runId,
        extractionId: r.id,
        rawItemId: r.rawItemId,
        sourceType,
        sourceName: r.sourceName,
        aiFailed: r.aiFailed,
        relevanceScore: r.relevanceScore,
        effectiveRelevance: r.effectiveRelevance,
        novelty: r.novelty,
        gatePassed: r.gatePassed,
        gateReason: r.gateReason,
        gateDetail: r.gateDetail,
        synthesisHandoff: r.synthesisHandoff,
        synthesisOrder: r.synthesisOrder,
        newsEditorOrder: editorOrder.get(r.id) ?? null,
        includedInReport: included,
        outcome: candidateOutcome({ ...r, sourceType, includedInReport: included }),
      };
    });

    for (let i = 0; i < values.length; i += 500) {
      await db.insert(runCandidates).values(values.slice(i, i + 500)).onConflictDoUpdate({
        target: [runCandidates.runId, runCandidates.extractionId],
        // A rerun of Phase 6 refreshes the verdicts of the same extraction.
        set: {
          aiFailed: sql`excluded.ai_failed`,
          relevanceScore: sql`excluded.relevance_score`,
          effectiveRelevance: sql`excluded.effective_relevance`,
          novelty: sql`excluded.novelty`,
          gatePassed: sql`excluded.gate_passed`,
          gateReason: sql`excluded.gate_reason`,
          gateDetail: sql`excluded.gate_detail`,
          synthesisHandoff: sql`excluded.synthesis_handoff`,
          synthesisOrder: sql`excluded.synthesis_order`,
          newsEditorOrder: sql`excluded.news_editor_order`,
          includedInReport: sql`excluded.included_in_report`,
          outcome: sql`excluded.outcome`,
        },
      });
    }
    return values.length;
  } catch (error) {
    console.warn(`run candidate ledger write failed: ${errMessage(error)}`);
    return 0;
  }
}
