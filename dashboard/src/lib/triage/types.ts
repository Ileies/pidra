/**
 * Triage page types (`/[date]/triage`, online-only) and `outcomeOf`, the pure rule folding a
 * delivery's per-story verdicts into one outcome. Filled by `#lib/server/triage.ts`; kept free of
 * `lib/server` imports so pages and cards can use it.
 */

import type { IngestFailure } from "#lib/pipeline.js";

/** The gate's verdict codes. Copied, not imported: the dashboard talks to the pipeline only through
 *  Postgres. Keep in sync with `src/pipeline/gate.ts`, where they are decided. */
export type GateReason =
  | "passed"
  | "below_threshold"
  | "skipped_by_extraction"
  | "teaser_only"
  | "extraction_failed"
  | "spam"
  | "general_news"
  | "automated_low_urgency"
  | "unverified_source"
  | "outside_window"
  | "duplicate"
  | "already_reported"
  | "not_gated";

export interface GateDetail {
  relevanceScore: number | null;
  trustScore: number;
  sourceCount: number;
  corroborationBonus: number;
  effectiveRelevance: number;
  threshold?: number;
  emailCategory?: string;
  urgency?: string;
  recordedBy: "phase3" | "backfill";
}

/** What became of one ingested mail or feed entry. Ordered as the page's filter chips are. */
export type Outcome =
  /** Cited in the briefing. */
  | "in_report"
  /** Handed to synthesis, which did not write about it. */
  | "passed"
  /** Gate-passed newsletter claim beyond Section 1's 30-item limit. */
  | "outside_synthesis_capacity"
  /** Extracted and then dropped by the relevance gate. */
  | "gated"
  /** The extraction call failed, so there was never anything to judge. */
  | "failed"
  /** Ingested but never extracted - a disabled source, or a run that stopped before Phase 2. */
  | "not_extracted"
  /** Thrown away by the ingest before it became a row at all. */
  | "dropped_at_ingest"
  /** Extracted before the gate was recorded, and not reconstructed. */
  | "unjudged";

export interface TriageExtraction {
  id: string;
  headline: string | null;
  keyClaim: string | null;
  topicTags: string[];
  actionRequired: string | null;
  deadline: string | null;
  skipReason: string | null;
  relevanceScore: number | null;
  /** The stored column. For a backfilled row this is still what the run of the day wrote. */
  effectiveRelevance: number | null;
  gatePassed: boolean | null;
  gateReason: GateReason | null;
  gateDetail: GateDetail | null;
  synthesisHandoff: "sent" | "outside_synthesis_capacity" | null;
  synthesisOrder: number | null;
  includedInReport: boolean;
  aiFailed: boolean;
  rating: string | null;
}

export interface TriageItem {
  /** The `raw_items` id, or the `ingest_drops` id for something that never became one. */
  id: string;
  subject: string | null;
  sender: string | null;
  /** Which mailbox it landed in. Null for RSS. */
  account: string | null;
  sourceName: string | null;
  sourceType: string;
  /** A `Date` over the wire: the driver hydrates timestamptz, and SvelteKit keeps it one. */
  receivedAt: string | Date | null;
  outcome: Outcome;
  /** Set on `dropped_at_ingest`: which ingest rule discarded it. */
  dropReason: string | null;
  /** False when the source was switched off, which is why nothing was extracted. */
  sourceActive: boolean | null;
  extractions: TriageExtraction[];
}

export interface TriageSummary {
  ingested: number;
  inReport: number;
  passed: number;
  outsideSynthesisCapacity: number;
  gated: number;
  failed: number;
  notExtracted: number;
  droppedAtIngest: number;
  unjudged: number;
  /** Extraction rows, which is a larger number than `ingested` for newsletters. */
  extractions: number;
  /** True when at least one verdict was reconstructed rather than recorded by the run. */
  hasReconstructed: boolean;
  /** Sources that never delivered on this date's run (a dead mailbox has no items to show, so
   *  without this the page would imply nothing arrived). Online-only, so unlike the mirror's copy
   *  these keep their `detail`. */
  ingestFailures: IngestFailure[];
}

/**
 * The single verdict for a delivery, from the verdicts of the items under it. A newsletter whose
 * eight stories were all dropped but one reads as "in report", which is correct: the delivery did
 * reach the reader. Per-story verdicts stay visible on the card.
 */
export function outcomeOf(extractions: TriageExtraction[]): Outcome {
  if (extractions.length === 0) return "not_extracted";
  if (extractions.some((e) => e.includedInReport)) return "in_report";
  if (extractions.some((e) => e.synthesisHandoff === "sent")) return "passed";
  if (extractions.some((e) => e.synthesisHandoff === "outside_synthesis_capacity")) return "outside_synthesis_capacity";
  // Older runs predate the separate handoff column.
  if (extractions.some((e) => e.gatePassed === true)) return "passed";
  if (extractions.every((e) => e.aiFailed)) return "failed";
  if (extractions.some((e) => e.gateReason !== null)) return "gated";
  return "unjudged";
}
