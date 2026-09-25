/**
 * Everything that arrived on one run date, and what the pipeline did with each of it.
 *
 * The report answers "what did the system decide to tell me". This answers the other question,
 * the one that has no other home: "here is a mail I know arrived - where did it go". Four
 * different fates are indistinguishable in the report itself, and three of them used to be
 * indistinguishable in the database too:
 *
 *   1. dropped by the IMAP ingest, before it was ever a row      → `ingest_drops`
 *   2. never extracted, because its source is switched off        → no extraction row
 *   3. extracted, then dropped by the Phase 3 relevance gate      → `extractions.gate_*`
 *   4. handed to synthesis, which chose not to write about it     → gate passed, not in the refs
 *
 * Only the last one leaves a trace in `included_in_report`, which is why that column alone could
 * never answer the question.
 *
 * Grouped by raw item rather than by extraction: one newsletter legitimately produces one row per
 * story, and seeing the delivery with its stories under it is what makes an empty one obvious.
 */

import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";
import { parseSender, parseTitle } from "#lib/mail.js";
import { ingestFailures, type IngestFailure, type StepAttempt } from "#lib/pipeline.js";

/**
 * The gate's verdict codes. Declared here, not imported: the dashboard is a separate package that
 * talks to the pipeline through Postgres only. `src/pipeline/gate.ts` is where they are decided
 * and where the reasoning lives.
 */
export type GateReason =
  | "passed"
  | "below_threshold"
  | "skipped_by_extraction"
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
  gated: number;
  failed: number;
  notExtracted: number;
  droppedAtIngest: number;
  unjudged: number;
  /** Extraction rows, which is a larger number than `ingested` for newsletters. */
  extractions: number;
  /** True when at least one verdict was reconstructed rather than recorded by the run. */
  hasReconstructed: boolean;
  /**
   * Sources that never delivered on the run behind this date. The decisive case the item list
   * cannot express: a mailbox that never answered has no items to show, so its mail is absent for
   * the same reason it is absent from the report, and without this the page would quietly imply
   * that nothing arrived there.
   *
   * Server-rendered and online-only, so unlike the report's copy these keep their `detail`.
   */
  ingestFailures: IngestFailure[];
}

/**
 * Mail-shaped sources, plus the news desks: each desk's delivery is one item with its stories under
 * it, like a newsletter's. Calendar entries and todos never pass through extraction at all.
 */
const MAIL_TYPES = ["newsletter", "personal_email", "sms", "web_news"];

type Row = {
  raw_item_id: string;
  source_type: string;
  source_name: string | null;
  account_id: string | null;
  received_at: string | Date | null;
  raw_header: string | null;
  source_active: boolean | null;
  extraction_id: string | null;
  extracted_json: unknown;
  relevance_score: number | null;
  effective_relevance: number | null;
  gate_passed: boolean | null;
  gate_reason: string | null;
  gate_detail: unknown;
  included_in_report: boolean | null;
  ai_failed: boolean | null;
  rating: string | null;
};

type DropRow = {
  id: string;
  account_id: string | null;
  source_type: string | null;
  source_name: string | null;
  subject: string | null;
  sender: string | null;
  received_at: string | Date | null;
  reason: string;
};

interface Extracted {
  headline?: string;
  key_claim?: string;
  topic_tags?: string[];
  action_required?: string | null;
  deadline?: string | null;
  skip_reason?: string | null;
}

/**
 * The single verdict for a delivery, from the verdicts of the items under it. A newsletter whose
 * eight stories were all dropped but one reads as "in report", which is correct: the delivery did
 * reach the reader. Per-story verdicts stay visible on the card.
 */
function outcomeOf(extractions: TriageExtraction[]): Outcome {
  if (extractions.length === 0) return "not_extracted";
  if (extractions.some((e) => e.includedInReport)) return "in_report";
  if (extractions.some((e) => e.gatePassed === true)) return "passed";
  if (extractions.every((e) => e.aiFailed)) return "failed";
  if (extractions.some((e) => e.gateReason !== null)) return "gated";
  return "unjudged";
}

export async function loadTriage(date: string): Promise<{ items: TriageItem[]; summary: TriageSummary }> {
  const db = sql();

  const [rows, dropRows, runRows] = await Promise.all([
    // Bodies stay in Postgres: the header block carries the subject and sender, and a day of
    // newsletter HTML is megabytes the page has no use for. The original is one click away on
    // the detail page.
    db`
      WITH items AS (
        SELECT id, source_type, source_name, account_id, received_at,
               split_part(raw_content, E'\n\n', 1) AS raw_header
        FROM raw_items
        WHERE run_date = ${date} AND source_type = ANY(${MAIL_TYPES})
      )
      SELECT
        i.id AS raw_item_id,
        i.source_type,
        i.source_name,
        i.account_id,
        i.received_at,
        i.raw_header,
        q.is_active AS source_active,
        e.id AS extraction_id,
        e.extracted_json,
        e.relevance_score,
        e.effective_relevance,
        e.gate_passed,
        e.gate_reason,
        e.gate_detail,
        e.included_in_report,
        e.ai_failed,
        f.event_type AS rating
      FROM items i
      LEFT JOIN extractions e ON e.raw_item_id = i.id
      LEFT JOIN source_quality q ON q.source_name = i.source_name
      LEFT JOIN LATERAL (
        SELECT event_type FROM feedback_events
        WHERE extraction_id = e.id AND event_type IN ('explicit_plus', 'explicit_minus')
        ORDER BY created_at DESC LIMIT 1
      ) f ON true
      ORDER BY i.received_at DESC NULLS LAST, i.id,
               e.included_in_report DESC NULLS LAST, e.effective_relevance DESC NULLS LAST
    `,
    db`
      SELECT id, account_id, source_type, source_name, subject, sender, received_at, reason
      FROM ingest_drops
      WHERE run_date = ${date}
      ORDER BY received_at DESC NULLS LAST
    `,
    // The newest run only, matching what the report page warns about. A date can carry several
    // attempts, and an earlier one that could not reach a mailbox the last one then read fine is
    // history rather than a gap in this list; `/runs` holds the history.
    db`SELECT step_errors FROM pipeline_runs WHERE run_date = ${date} ORDER BY started_at DESC LIMIT 1`,
  ]);

  const items: TriageItem[] = [];
  const byRawItem = new Map<string, TriageItem>();

  for (const row of rows as unknown as Row[]) {
    let item = byRawItem.get(row.raw_item_id);
    if (!item) {
      item = {
        id: row.raw_item_id,
        subject: parseTitle(row.raw_header),
        sender: parseSender(row.raw_header),
        account: row.account_id,
        sourceName: row.source_name,
        sourceType: row.source_type,
        receivedAt: row.received_at,
        outcome: "not_extracted",
        dropReason: null,
        sourceActive: row.source_active,
        extractions: [],
      };
      byRawItem.set(row.raw_item_id, item);
      items.push(item);
    }

    if (!row.extraction_id) continue;

    const extracted = parseJsonb<Extracted | null>(row.extracted_json, null);
    item.extractions.push({
      id: row.extraction_id,
      headline: extracted?.headline ?? null,
      keyClaim: extracted?.key_claim ?? null,
      topicTags: extracted?.topic_tags ?? [],
      actionRequired: extracted?.action_required ?? null,
      deadline: extracted?.deadline ?? null,
      skipReason: extracted?.skip_reason ?? null,
      relevanceScore: row.relevance_score,
      effectiveRelevance: row.effective_relevance,
      gatePassed: row.gate_passed,
      gateReason: (row.gate_reason as GateReason | null) ?? null,
      gateDetail: parseJsonb<GateDetail | null>(row.gate_detail, null),
      includedInReport: row.included_in_report ?? false,
      aiFailed: row.ai_failed ?? false,
      rating: row.rating,
    });
  }

  for (const item of items) item.outcome = outcomeOf(item.extractions);

  for (const drop of dropRows as unknown as DropRow[]) {
    items.push({
      id: drop.id,
      subject: drop.subject,
      sender: drop.sender,
      account: drop.account_id,
      sourceName: drop.source_name,
      sourceType: drop.source_type ?? "personal_email",
      receivedAt: drop.received_at,
      outcome: "dropped_at_ingest",
      dropReason: drop.reason,
      sourceActive: null,
      extractions: [],
    });
  }

  // One chronological list, drops included: the reader is looking for a mail by when it arrived,
  // not by which stage happened to discard it. Compared as timestamps, because the driver hands
  // back a `Date` for a timestamptz and a string compare would throw on it.
  const stamp = (value: TriageItem["receivedAt"]): number => (value ? new Date(value).getTime() : 0);
  items.sort((a, b) => stamp(b.receivedAt) - stamp(a.receivedAt));

  const count = (outcome: Outcome) => items.filter((i) => i.outcome === outcome).length;

  return {
    items,
    summary: {
      ingested: items.length - count("dropped_at_ingest"),
      inReport: count("in_report"),
      passed: count("passed"),
      gated: count("gated"),
      failed: count("failed"),
      notExtracted: count("not_extracted"),
      droppedAtIngest: count("dropped_at_ingest"),
      unjudged: count("unjudged"),
      extractions: items.reduce((sum, i) => sum + i.extractions.length, 0),
      hasReconstructed: items.some((i) => i.extractions.some((e) => e.gateDetail?.recordedBy === "backfill")),
      ingestFailures: ingestFailures(parseJsonb<StepAttempt[]>(runRows[0]?.step_errors, [])),
    },
  };
}
