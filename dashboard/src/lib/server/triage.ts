/**
 * Everything that arrived on one run date, and what the pipeline did with each of it.
 *
 * Answers "here is a mail I know arrived - where did it go". Types: `lib/triage/types.ts`. Fates
 * that the report itself cannot distinguish:
 *
 *   1. dropped by the IMAP ingest, before it was ever a row      → `ingest_drops`
 *   2. never extracted, because its source is switched off        → no extraction row
 *   3. extracted, then dropped by the Phase 3 relevance gate      → `extractions.gate_*`
 *   4. passed the gate but fell outside Section 1 capacity        → synthesis handoff
 *   5. handed to synthesis, which chose not to write about it     → sent, not in the refs
 *
 * Only the last leaves a trace in `included_in_report`. Grouped by raw item, not extraction: a
 * newsletter yields one row per story, and the delivery with its stories makes an empty one obvious.
 */

import { sql } from "#lib/server/postgres.js";
import { parseJsonb } from "#lib/jsonb.js";
import { parseSender, parseTitle } from "#lib/mail.js";
import { ingestFailures, type StepAttempt } from "#lib/pipeline.js";
import {
  outcomeOf,
  type GateDetail,
  type GateReason,
  type Outcome,
  type TriageExtraction,
  type TriageItem,
  type TriageSummary,
} from "#lib/triage/types.js";

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
  synthesis_handoff: string | null;
  synthesis_order: number | null;
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


export async function loadTriage(date: string): Promise<{ items: TriageItem[]; summary: TriageSummary }> {
  const db = sql();

  const [rows, dropRows, runRows] = await Promise.all([
    // Bodies stay in Postgres: the header block carries the subject and sender, and a day of
    // newsletter HTML is megabytes the page has no use for. The original is one click away on
    // the detail page.
    db<Row[]>`
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
        e.synthesis_handoff,
        e.synthesis_order,
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
    db<DropRow[]>`
      SELECT id, account_id, source_type, source_name, subject, sender, received_at, reason
      FROM ingest_drops
      WHERE run_date = ${date}
      ORDER BY received_at DESC NULLS LAST
    `,
    // Newest run only, matching the report page's warning; earlier attempts are history (`/runs`).
    db`SELECT step_errors FROM pipeline_runs WHERE run_date = ${date} ORDER BY started_at DESC LIMIT 1`,
  ]);

  const items: TriageItem[] = [];
  const byRawItem = new Map<string, TriageItem>();

  for (const row of rows) {
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
      synthesisHandoff: (row.synthesis_handoff as TriageExtraction["synthesisHandoff"]) ?? null,
      synthesisOrder: row.synthesis_order,
      includedInReport: row.included_in_report ?? false,
      aiFailed: row.ai_failed ?? false,
      rating: row.rating,
    });
  }

  for (const item of items) item.outcome = outcomeOf(item.extractions);

  for (const drop of dropRows) {
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

  const counts: Record<Outcome, number> = {
    in_report: 0, passed: 0, outside_synthesis_capacity: 0, gated: 0, failed: 0,
    not_extracted: 0, dropped_at_ingest: 0, unjudged: 0,
  };
  let extractionCount = 0;
  let hasReconstructed = false;
  for (const item of items) {
    counts[item.outcome]++;
    extractionCount += item.extractions.length;
    hasReconstructed ||= item.extractions.some((e) => e.gateDetail?.recordedBy === "backfill");
  }

  return {
    items,
    summary: {
      ingested: items.length - counts.dropped_at_ingest,
      inReport: counts.in_report,
      passed: counts.passed,
      outsideSynthesisCapacity: counts.outside_synthesis_capacity,
      gated: counts.gated,
      failed: counts.failed,
      notExtracted: counts.not_extracted,
      droppedAtIngest: counts.dropped_at_ingest,
      unjudged: counts.unjudged,
      extractions: extractionCount,
      hasReconstructed,
      ingestFailures: ingestFailures(parseJsonb<StepAttempt[]>(runRows[0]?.step_errors, [])),
    },
  };
}
