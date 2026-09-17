import type { Actions, PageServerLoad } from "./$types";
import { error, fail } from "@sveltejs/kit";
import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";
import { parseSender, parseTitle } from "#lib/mail.js";

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** Deliveries shown, newest first. Enough to judge a source, not enough to ship a whole archive. */
const DELIVERY_LIMIT = 80;

export interface SourceItem {
  id: string;
  headline: string | null;
  keyClaim: string | null;
  topicTags: string[];
  relevanceScore: number | null;
  effectiveRelevance: number | null;
  novelty: string | null;
  includedInReport: boolean;
  aiFailed: boolean;
  rating: string | null;
  runDate: string | null;
  /** Set when extraction deliberately produced no content, e.g. "promotional". */
  skipReason: string | null;
}

/**
 * One ingested email or feed entry, with the items extraction made out of it. A delivery with an
 * empty `items` list is the interesting case: it arrived and produced nothing, which is exactly
 * what drags a score down.
 */
export interface Delivery {
  rawItemId: string;
  title: string | null;
  sender: string | null;
  sourceType: string;
  receivedAt: string | null;
  runDate: string;
  items: SourceItem[];
}

export interface SourceStats {
  deliveries: number;
  items: number;
  emptyDeliveries: number;
  /** Extraction rows that carry no headline: skipped as promotional or empty. */
  skipped: number;
  included: number;
  aiFailed: number;
  avgRelevance: number | null;
  avgEffectiveRelevance: number | null;
  plus: number;
  minus: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

type ItemRow = {
  raw_item_id: string;
  received_at: string | null;
  run_date: string;
  source_type: string;
  raw_header: string | null;
  extraction_id: string | null;
  extracted_json: unknown;
  relevance_score: number | null;
  effective_relevance: number | null;
  novelty: string | null;
  included_in_report: boolean | null;
  ai_failed: boolean | null;
  extraction_run_date: string | null;
  rating: string | null;
};

export const load: PageServerLoad = async ({ params }) => {
  const sourceName = decodeURIComponent(params.name);
  const db = sql();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];

  const [qualityRows, dailyRows, rows, statsRows, ratingRows] = await Promise.all([
    db`
      SELECT source_name, trust_score, include_rate_30d, avg_revealed_relevance, quality_trend,
             promotional_rate_30d, composite_score_30d, is_active, disabled_at, disabled_reason,
             notes, updated_at
      FROM source_quality WHERE source_name = ${sourceName}
    `,
    db`
      SELECT run_date AS "runDate", items_received AS "itemsReceived",
             items_included AS "itemsIncluded", avg_relevance AS "avgRelevance",
             avg_effective_relevance AS "avgEffectiveRelevance", include_rate AS "includeRate",
             composite_score AS "compositeScore"
      FROM source_daily_scores
      WHERE source_name = ${sourceName} AND run_date >= ${thirtyDaysAgo}
      ORDER BY run_date DESC
    `,
    // The header block is all the template needs for a title, so the bodies stay in Postgres.
    db`
      WITH deliveries AS (
        SELECT id, received_at, run_date, source_type, split_part(raw_content, E'\n\n', 1) AS raw_header
        FROM raw_items
        WHERE source_name = ${sourceName}
        ORDER BY received_at DESC NULLS LAST
        LIMIT ${DELIVERY_LIMIT}
      )
      SELECT
        d.id AS raw_item_id,
        d.received_at,
        d.run_date,
        d.source_type,
        d.raw_header,
        e.id AS extraction_id,
        e.extracted_json,
        e.relevance_score,
        e.effective_relevance,
        e.novelty,
        e.included_in_report,
        e.ai_failed,
        e.run_date AS extraction_run_date,
        f.event_type AS rating
      FROM deliveries d
      LEFT JOIN extractions e ON e.raw_item_id = d.id
      LEFT JOIN LATERAL (
        SELECT event_type FROM feedback_events
        WHERE extraction_id = e.id AND event_type IN ('explicit_plus', 'explicit_minus')
        ORDER BY created_at DESC LIMIT 1
      ) f ON true
      ORDER BY d.received_at DESC NULLS LAST, d.id, e.effective_relevance DESC NULLS LAST
    `,
    // Lifetime totals, deliberately over every row rather than only the shown page.
    db`
      SELECT
        count(DISTINCT r.id)::int AS deliveries,
        count(e.id)::int AS items,
        count(DISTINCT r.id) FILTER (WHERE e.id IS NULL)::int AS empty_deliveries,
        -- extracted_json is stored as a JSON string scalar (see $lib/jsonb), so it is unwrapped
        -- before the lookup; the CASE keeps this working if the column is ever normalised.
        count(e.id) FILTER (WHERE coalesce(
          CASE WHEN jsonb_typeof(e.extracted_json) = 'string'
               THEN (e.extracted_json #>> '{}')::jsonb
               ELSE e.extracted_json END ->> 'headline', '') = '')::int AS skipped,
        count(e.id) FILTER (WHERE e.included_in_report)::int AS included,
        count(e.id) FILTER (WHERE e.ai_failed)::int AS ai_failed,
        avg(e.relevance_score)::float8 AS avg_relevance,
        avg(e.effective_relevance)::float8 AS avg_effective_relevance,
        min(r.received_at) AS first_seen,
        max(r.received_at) AS last_seen
      FROM raw_items r
      LEFT JOIN extractions e ON e.raw_item_id = r.id
      WHERE r.source_name = ${sourceName}
    `,
    db`
      SELECT f.event_type, count(*)::int AS n
      FROM feedback_events f
      JOIN extractions e ON e.id = f.extraction_id
      JOIN raw_items r ON r.id = e.raw_item_id
      WHERE r.source_name = ${sourceName} AND f.event_type IN ('explicit_plus', 'explicit_minus')
      GROUP BY f.event_type
    `,
  ]);

  const quality = (qualityRows[0] ?? null) as {
    source_name: string;
    trust_score: number | null;
    include_rate_30d: number | null;
    avg_revealed_relevance: number | null;
    quality_trend: string | null;
    promotional_rate_30d: number | null;
    composite_score_30d: number | null;
    is_active: boolean;
    disabled_at: string | null;
    disabled_reason: string | null;
    notes: string | null;
  } | null;

  // A source with neither a quality row nor a single ingested item is a bad URL, not an empty page.
  if (!quality && rows.length === 0) error(404, `Unbekannte Quelle: ${sourceName}`);

  const deliveries: Delivery[] = [];
  const byRawItem = new Map<string, Delivery>();
  for (const row of rows as unknown as ItemRow[]) {
    let delivery = byRawItem.get(row.raw_item_id);
    if (!delivery) {
      delivery = {
        rawItemId: row.raw_item_id,
        title: parseTitle(row.raw_header),
        sender: parseSender(row.raw_header),
        sourceType: row.source_type,
        receivedAt: row.received_at,
        runDate: row.run_date,
        items: [],
      };
      byRawItem.set(row.raw_item_id, delivery);
      deliveries.push(delivery);
    }

    if (!row.extraction_id) continue;

    const extracted = parseJsonb<{
      headline?: string;
      key_claim?: string;
      topic_tags?: string[];
      skip_reason?: string | null;
    } | null>(row.extracted_json, null);

    delivery.items.push({
      id: row.extraction_id,
      headline: extracted?.headline ?? null,
      keyClaim: extracted?.key_claim ?? null,
      topicTags: extracted?.topic_tags ?? [],
      relevanceScore: row.relevance_score,
      effectiveRelevance: row.effective_relevance,
      novelty: row.novelty,
      includedInReport: row.included_in_report ?? false,
      aiFailed: row.ai_failed ?? false,
      rating: row.rating,
      runDate: row.extraction_run_date,
      skipReason: extracted?.skip_reason ?? null,
    });
  }

  const s = statsRows[0] as Record<string, unknown>;
  const ratings = new Map(
    (ratingRows as unknown as { event_type: string; n: number }[]).map((r) => [r.event_type, r.n]),
  );

  const stats: SourceStats = {
    deliveries: (s?.deliveries as number) ?? 0,
    items: (s?.items as number) ?? 0,
    emptyDeliveries: (s?.empty_deliveries as number) ?? 0,
    skipped: (s?.skipped as number) ?? 0,
    included: (s?.included as number) ?? 0,
    aiFailed: (s?.ai_failed as number) ?? 0,
    avgRelevance: (s?.avg_relevance as number | null) ?? null,
    avgEffectiveRelevance: (s?.avg_effective_relevance as number | null) ?? null,
    plus: ratings.get("explicit_plus") ?? 0,
    minus: ratings.get("explicit_minus") ?? 0,
    firstSeen: (s?.first_seen as string | null) ?? null,
    lastSeen: (s?.last_seen as string | null) ?? null,
  };

  return {
    sourceName,
    quality,
    dailyScores: dailyRows as unknown as {
      runDate: string;
      itemsReceived: number;
      itemsIncluded: number;
      avgRelevance: number | null;
      avgEffectiveRelevance: number | null;
      includeRate: number | null;
      compositeScore: number | null;
    }[],
    deliveries,
    stats,
    deliveryLimit: DELIVERY_LIMIT,
  };
};

export const actions: Actions = {
  toggle: async ({ request, params }) => {
    const data = await request.formData();
    const sourceName = decodeURIComponent(params.name);
    const isActive = data.get("isActive") === "true";
    const reason = (data.get("reason") as string) || undefined;

    const res = await fetch(`${API}/api/sources/${encodeURIComponent(sourceName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive, reason }),
    });

    if (!res.ok) return fail(500, { error: "API error" });
    return { ok: true };
  },
};
