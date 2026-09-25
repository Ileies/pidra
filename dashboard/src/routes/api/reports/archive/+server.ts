import type { RequestHandler } from "./$types";
import { sql } from "#lib/db.js";

/**
 * The report archive, fetched when the date picker opens (C8, E7).
 *
 * The report page used to serialise all 60 available dates to the client on every load, where
 * nothing read them (X3). Prev and next are two scalar queries on the server now, and the list
 * lives here - so it is paid for when the picker is actually opened, and it can carry each day's
 * summary as a preview without bloating every page load.
 */
export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 120);

  const rows = await sql()`
    SELECT report_date::text AS report_date, short_summary, items_included
    FROM daily_reports
    ORDER BY report_date DESC
    LIMIT ${limit}
  `;

  return Response.json({
    days: (rows as unknown as { report_date: string; short_summary: string | null; items_included: number | null }[]).map(
      (row) => ({
        date: row.report_date,
        // The stored summary is the first few lines of Section 1 verbatim, markdown and all.
        // One trimmed line is what a picker row has space for.
        summary: (row.short_summary ?? "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || null,
        itemsIncluded: row.items_included,
      }),
    ),
  });
};
