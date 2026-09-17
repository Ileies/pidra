/**
 * Loading extractions by id, in one place.
 *
 * Two callers need the same rows: the deep-link page at `/[date]/detail/[ids]`, and the report's
 * inline expansion (C5), which renders the same cards under an entry without navigating away.
 * They must show the same thing, so they read through the same function.
 */

import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";
import { parseSender, tidyRawContent } from "#lib/mail.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most ten: a report entry anchors one or two, and the URL form is user-editable. */
export function parseIds(raw: string): string[] {
  return raw.split(",").filter((id) => UUID_RE.test(id)).slice(0, 10);
}

export interface ExtractedJson {
  headline?: string;
  key_claim?: string;
  topic_tags?: string[];
  entities?: string[];
  type?: string;
  urgency?: string;
  action_required?: string | null;
  deadline?: string | null;
}

export interface ExtractionItem {
  id: string;
  sourceName: string | null;
  sourceType: string;
  receivedAt: string | null;
  rawContent: string | null;
  sender: string | null;
  receiver: string | null;
  novelty: string | null;
  relevanceScore: number | null;
  effectiveRelevance: number | null;
  rating: string | null;
  extracted: ExtractedJson | null;
}

export interface LoadOptions {
  /** Skip the raw email body. The inline expansion does not show it and it is the big field. */
  withRawContent?: boolean;
}

export async function loadExtractions(ids: string[], options: LoadOptions = {}): Promise<ExtractionItem[]> {
  if (ids.length === 0) return [];

  const db = sql();
  const [rows, ratedRows] = await Promise.all([
    db`
      SELECT
        e.id,
        e.extracted_json,
        e.relevance_score,
        e.effective_relevance,
        e.novelty,
        r.source_type,
        r.source_name,
        r.account_id,
        r.raw_content,
        r.received_at
      FROM extractions e
      JOIN raw_items r ON r.id = e.raw_item_id
      WHERE e.id::text = ANY(${ids})
      ORDER BY e.effective_relevance DESC NULLS LAST
    `,
    db`
      SELECT extraction_id, event_type FROM feedback_events
      WHERE extraction_id::text = ANY(${ids})
      AND event_type IN ('explicit_plus', 'explicit_minus')
    `,
  ]);

  const ratings = new Map(
    (ratedRows as unknown as { extraction_id: string; event_type: string }[]).map((row) => [
      row.extraction_id,
      row.event_type,
    ]),
  );

  return rows.map((row) => ({
    id: row.id as string,
    sourceName: row.source_name as string | null,
    sourceType: row.source_type as string,
    receivedAt: row.received_at as string | null,
    // Tidied here rather than in the template: the blank-line runs are no use to the browser
    // either, and a long newsletter ships a lot smaller without them.
    rawContent: options.withRawContent === false ? null : tidyRawContent(row.raw_content as string | null),
    sender: parseSender(row.raw_content as string | null),
    receiver: row.account_id as string | null,
    novelty: row.novelty as string | null,
    relevanceScore: row.relevance_score as number | null,
    effectiveRelevance: row.effective_relevance as number | null,
    rating: ratings.get(row.id as string) ?? null,
    extracted: parseJsonb<ExtractedJson | null>(row.extracted_json, null),
  }));
}

/** Writes an explicit +/- rating. One rating per extraction: the previous one is replaced. */
export async function rateExtraction(extractionId: string, signal: "1" | "-1"): Promise<string> {
  const db = sql();
  const eventType = signal === "1" ? "explicit_plus" : "explicit_minus";

  await db`DELETE FROM feedback_events WHERE extraction_id = ${extractionId} AND event_type IN ('explicit_plus', 'explicit_minus')`;
  await db`INSERT INTO feedback_events (extraction_id, event_type, signal_value) VALUES (${extractionId}, ${eventType}, ${parseInt(signal, 10)})`;

  return eventType;
}
