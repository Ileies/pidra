/**
 * What a newsletter source's daily score and trust are built from.
 *
 * Used by `phase6/source-scoring.ts` and `weekly-source-scoring.ts` (formulas: docs/scoring-formulas.md).
 *
 * Deliberately built from the item's own score (`neutralRelevance`), never from `effective_relevance`
 * or bare `included_in_report`: both already include the gate's trust multiplier, so a source under
 * the bar would score lower, lose trust, and never recover (a feedback loop). Trust must follow what
 * a source sends, not what the gate did to it.
 */

import { NEWSLETTER_THRESHOLD } from "./gate";
import type { GateDetail } from "./gate";

export interface ScoredItem {
  relevanceScore: number | null;
  gateReason: string | null;
  gateDetail: Pick<GateDetail, "corroborationBonus"> | null;
  includedInReport: boolean | null;
}

/** Relevance at neutral trust: the item's own score plus the corroboration it earned, no trust factor. */
export function neutralRelevance(item: Pick<ScoredItem, "relevanceScore" | "gateDetail">): number {
  return (item.relevanceScore ?? 0) + (item.gateDetail?.corroborationBonus ?? 0);
}

/**
 * Whether the item counts as taken. One in the report is. One the gate rejected only because of
 * the source's trust is too (it would have cleared at neutral trust), otherwise a distrusted
 * source could never show that it deserves more. Teasers, skipped mail and items synthesis
 * received but left out are not.
 */
export function countsAsIncluded(item: ScoredItem): boolean {
  if (item.includedInReport === true) return true;
  return item.gateReason === "below_threshold" && neutralRelevance(item) >= NEWSLETTER_THRESHOLD;
}

/** The 0-10 daily composite: quality (7 points) plus breadth (3 points). */
export function dailyComposite(avgNeutralRelevance: number, includeRate: number): number {
  return Math.min(10, (avgNeutralRelevance / 5) * 7 + includeRate * 3);
}

/** A week of fewer items than this says too little to override the 30-day figure. */
export const RECENT_MIN_ITEMS = 5;

/**
 * The composite trust is read from: the rolling 30 days, unless the last 7 are better and rest on
 * enough items. Recovery is fast, decay stays slow, so a source that starts sending real content
 * is noticed within the week and one bad day does not matter either way.
 */
export function trustComposite(composite30d: number, composite7d: number | null, items7d: number): number {
  return composite7d != null && items7d >= RECENT_MIN_ITEMS ? Math.max(composite30d, composite7d) : composite30d;
}

/** 5/10 is neutral (1.0), 10/10 is 2.0 and 0/10 is 0.5. */
export function trustFromComposite(composite: number): number {
  return Math.min(2.0, Math.max(0.5, composite / 5));
}
