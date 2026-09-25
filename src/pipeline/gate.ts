/**
 * The Phase 3 relevance gate: which extracted items are handed to synthesis, and why the rest
 * are not.
 *
 * This decision used to live as two anonymous `.filter()` calls at the bottom of
 * `phase3-context.ts`, and it left no trace anywhere. An item that dropped out here was simply
 * absent from the report, indistinguishable from one that was never ingested, one whose
 * extraction failed, and one that synthesis saw and chose not to write about. When an important
 * mail did not appear in the briefing of 2026-09-12 there was nothing to look at: the only
 * persisted verdict was `included_in_report`, which Phase 6 sets from the report's own refs and
 * which is therefore false for all four of those cases at once.
 *
 * So the gate is a function with named outcomes now, and Phase 3 writes its verdict per
 * extraction (`gate_passed`, `gate_reason`, `gate_detail`). `/[date]/triage` reads them back.
 *
 * It stays pure on purpose: the same function decides the live run and reconstructs the verdict
 * for rows written before the columns existed (`scripts/backfill-gate.ts`), so the history the
 * view shows is the real rule rather than a second implementation of it.
 */

import type { NewsValidation } from "../news/validate";

/** A newsletter item needs this much effective relevance to be handed to synthesis. */
export const NEWSLETTER_THRESHOLD = 3;

/**
 * A news desk story needs this significance, on its own desk's scale, to reach the News section.
 * The desks are told the same bar; this is the net under that instruction.
 */
export const NEWS_THRESHOLD = 3;

/** A country the reader follows from abroad gets its top headlines only. */
export const NEWS_ABROAD_THRESHOLD = 4;

export type GateReason =
  /** Handed to synthesis. Whether synthesis then wrote about it is `included_in_report`. */
  | "passed"
  /** Scored, but under the bar for its kind. */
  | "below_threshold"
  /** Extraction deliberately produced no item - promotional, or nothing of substance. */
  | "skipped_by_extraction"
  /** The extraction call itself failed; there was never anything to judge. */
  | "extraction_failed"
  | "spam"
  | "general_news"
  /** An automated mail that was not urgent enough to be worth the user's morning. */
  | "automated_low_urgency"
  /** News desk: none of its sources is a URL the search returned, so nothing shows it was read. */
  | "unverified_source"
  /** News desk: the development predates the window - an old story presented as today's. */
  | "outside_window"
  /** News desk: another desk found the same story in the same run, and that copy was kept. */
  | "duplicate"
  /** News desk: the reader was told this on an earlier day, and the desk reported nothing new. */
  | "already_reported"
  /** A source type the gate does not apply to - calendar and todo go straight to Phase 3. */
  | "not_gated";

/** The arithmetic behind the verdict, kept so the view can show the sum rather than the result. */
export interface GateDetail {
  /** What extraction scored the item, before trust and corroboration. */
  relevanceScore: number | null;
  /** The source's trust score at the time of the run, the multiplier on the above. */
  trustScore: number;
  /** How many distinct raw items carried the same entities - the corroboration input. */
  sourceCount: number;
  corroborationBonus: number;
  /**
   * `relevanceScore * trustScore + corroborationBonus`: the number the gate compared. Kept on the
   * record rather than read back off `extractions.effective_relevance`, because a reconstructed
   * verdict must show the figure it actually used and must not rewrite a historical column.
   */
  effectiveRelevance: number;
  /** The bar this item had to clear, for the kinds that have a numeric one. */
  threshold?: number;
  /** Personal mail only, from the classification. */
  emailCategory?: string;
  urgency?: string;
  /**
   * How this verdict came to be recorded: by the run itself, or reconstructed afterwards from
   * the stored extraction. A reconstruction cannot know the trust score of the day, so it uses
   * 1.0 and says so here rather than inventing a plausible number.
   */
  recordedBy: "phase3" | "backfill";
}

export interface GateDecision {
  passed: boolean;
  reason: GateReason;
  /** Trust-weighted and corroborated. This is the number the gate compared, not Phase 2's. */
  effectiveRelevance: number;
  detail: GateDetail;
}

export interface GateInput {
  sourceType: string;
  aiFailed: boolean;
  extractedJson: Record<string, unknown> | null;
  relevanceScore: number | null;
  /** `source_quality.trust_score`, or 1.0 for a source that has none yet. */
  trustScore: number;
  /** Distinct raw items sharing an entity with this one, this item included. */
  sourceCount: number;
  recordedBy?: GateDetail["recordedBy"];
}

/** Several sources carrying the same entities is evidence; one source is a claim. */
export function corroborationBonus(sourceCount: number): number {
  if (sourceCount >= 4) return 1.0;
  if (sourceCount === 3) return 0.7;
  if (sourceCount === 2) return 0.3;
  return 0;
}

export function decideGate(input: GateInput): GateDecision {
  const bonus = corroborationBonus(input.sourceCount);
  const effectiveRelevance = (input.relevanceScore ?? 0) * input.trustScore + bonus;

  const json = input.extractedJson ?? {};
  const emailCategory = typeof json.email_category === "string" ? json.email_category : undefined;
  const urgency = typeof json.urgency === "string" ? json.urgency : undefined;

  const detail: GateDetail = {
    relevanceScore: input.relevanceScore,
    trustScore: input.trustScore,
    sourceCount: input.sourceCount,
    corroborationBonus: bonus,
    effectiveRelevance,
    ...(emailCategory ? { emailCategory } : {}),
    ...(urgency ? { urgency } : {}),
    recordedBy: input.recordedBy ?? "phase3",
  };

  const verdict = (passed: boolean, reason: GateReason, threshold?: number): GateDecision => ({
    passed,
    reason,
    effectiveRelevance,
    detail: threshold === undefined ? detail : { ...detail, threshold },
  });

  if (input.aiFailed) return verdict(false, "extraction_failed");

  if (input.sourceType === "newsletter") {
    // Phase 2 writes one row carrying only `skip_reason` when the model found nothing worth
    // extracting. Scoring that as "below threshold" would be true and useless.
    const skipped = typeof json.skip_reason === "string" && json.skip_reason.length > 0 && !json.headline;
    if (skipped) return verdict(false, "skipped_by_extraction", NEWSLETTER_THRESHOLD);

    return effectiveRelevance >= NEWSLETTER_THRESHOLD
      ? verdict(true, "passed", NEWSLETTER_THRESHOLD)
      : verdict(false, "below_threshold", NEWSLETTER_THRESHOLD);
  }

  if (input.sourceType === "personal_email" || input.sourceType === "sms") {
    // Categories first, then the score: a spam mail with a high urgency is still spam, and the
    // reason the reader needs is the category, not the number.
    if (emailCategory === "spam") return verdict(false, "spam");
    if (emailCategory === "general_news") return verdict(false, "general_news");
    if (emailCategory === "automated") {
      return urgency === "critical" || urgency === "high"
        ? verdict(true, "passed")
        : verdict(false, "automated_low_urgency");
    }
    // `personal_important`, and anything the classifier left blank: judged on the score alone,
    // which for personal mail is the category-and-urgency figure Phase 2 wrote.
    return effectiveRelevance > 0 ? verdict(true, "passed") : verdict(false, "below_threshold", 0);
  }

  if (input.sourceType === "web_news") {
    // The checks ran when the desk answered (src/news/validate.ts), because they need what only
    // that call had: the URLs its search returned. This names their outcome. Checks before the
    // score: a fabricated story that claims a 5 is still fabricated.
    const validation = (json.validation ?? {}) as Partial<NewsValidation>;
    const bar = validation.abroad ? NEWS_ABROAD_THRESHOLD : NEWS_THRESHOLD;
    if (validation.verified === false) return verdict(false, "unverified_source", bar);
    if (validation.inWindow === false) return verdict(false, "outside_window", bar);
    if (validation.duplicateOf) return verdict(false, "duplicate", bar);
    if (validation.alreadyReported) return verdict(false, "already_reported", bar);

    return effectiveRelevance >= bar
      ? verdict(true, "passed", bar)
      : verdict(false, "below_threshold", bar);
  }

  return verdict(false, "not_gated");
}

/** One line of plain English per outcome, shared by the view and by anything that logs one. */
export const GATE_REASON_TEXT: Record<GateReason, string> = {
  passed: "Handed to synthesis",
  below_threshold: "Scored under the bar",
  skipped_by_extraction: "Extraction found nothing to report",
  extraction_failed: "The extraction call failed",
  spam: "Classified as spam",
  general_news: "Classified as general news, not personal",
  automated_low_urgency: "Automated and not urgent",
  unverified_source: "No source the search actually returned",
  outside_window: "Happened before the news window",
  duplicate: "Same story as another desk's",
  already_reported: "Already reported on an earlier day",
  not_gated: "Not subject to the gate",
};
