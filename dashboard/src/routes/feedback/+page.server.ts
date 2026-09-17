import type { PageServerLoad } from "./$types";
import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";

/**
 * The rating log (D9).
 *
 * /sources/[name] shows the per-source totals (`+n / −m`); this is the item level behind them.
 * The calibration loop is only trustworthy if it is auditable: what was rated, from which
 * source, and whether the rating agreed with what the pipeline decided about the item.
 *
 * Implicit signals are included and labelled. They outnumber explicit ones by a wide margin and
 * they feed the same scoring, so hiding them would make the explicit ratings look more
 * influential than they are.
 */

export interface FeedbackRow {
  id: string;
  eventType: string;
  signalValue: number | null;
  createdAt: string | null;
  extractionId: string | null;
  runDate: string | null;
  sourceName: string | null;
  headline: string | null;
  includedInReport: boolean;
  effectiveRelevance: number | null;
  /** True when a report exists for that day, so a row only links where there is one. */
  hasReport: boolean;
}

const EXPLICIT = ["explicit_plus", "explicit_minus"];

export const load: PageServerLoad = async ({ url }) => {
  const only = url.searchParams.get("only") ?? "explicit";

  const db = sql();
  const [rows, totals] = await Promise.all([
    db`
      SELECT
        f.id, f.event_type, f.signal_value, f.created_at, f.extraction_id::text AS extraction_id,
        e.run_date::text AS run_date, e.extracted_json, e.included_in_report, e.effective_relevance,
        r.source_name,
        (d.report_date IS NOT NULL) AS has_report
      FROM feedback_events f
      LEFT JOIN extractions e ON e.id = f.extraction_id
      LEFT JOIN raw_items r ON r.id = e.raw_item_id
      LEFT JOIN daily_reports d ON d.report_date = e.run_date
      WHERE (${only} = 'all' OR f.event_type = ANY(${EXPLICIT}))
      ORDER BY f.created_at DESC
      LIMIT 200
    `,
    db`SELECT event_type, count(*)::int AS n FROM feedback_events GROUP BY event_type`,
  ]);

  const byType = Object.fromEntries(
    (totals as unknown as { event_type: string; n: number }[]).map((row) => [row.event_type, row.n]),
  );

  return {
    only,
    events: rows.map((row) => {
      const extracted = parseJsonb<{ headline?: string; key_claim?: string } | null>(row.extracted_json, null);
      return {
        id: row.id as string,
        eventType: row.event_type as string,
        signalValue: (row.signal_value as number | null) ?? null,
        createdAt: (row.created_at as string | null) ?? null,
        extractionId: (row.extraction_id as string | null) ?? null,
        runDate: (row.run_date as string | null) ?? null,
        sourceName: (row.source_name as string | null) ?? null,
        headline: extracted?.headline ?? extracted?.key_claim ?? null,
        includedInReport: !!row.included_in_report,
        effectiveRelevance: (row.effective_relevance as number | null) ?? null,
        hasReport: !!row.has_report,
      };
    }) as FeedbackRow[],
    totals: {
      plus: byType.explicit_plus ?? 0,
      minus: byType.explicit_minus ?? 0,
      implicit: Object.entries(byType)
        .filter(([type]) => !EXPLICIT.includes(type))
        .reduce((sum, [, n]) => sum + n, 0),
    },
  };
};
