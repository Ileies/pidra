import type { Actions, PageServerLoad } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/db.js";

/**
 * Active topics (D1).
 *
 * Story continuity is the reason the system compounds over days, and it had no UI at all - the
 * running summaries that make tomorrow's briefing say "UPDATE:" instead of re-explaining a story
 * were invisible.
 *
 * The days list is the window a topic was live in, from `first_seen` to `last_updated`, filtered
 * to the days that actually produced a report. There is no topic-to-report join table, so this
 * is a range rather than a record of appearances, and the UI says so.
 */

export interface TopicRow {
  id: string;
  headline: string;
  domain: string;
  runningSummary: string | null;
  firstSeen: string;
  lastUpdated: string;
  status: string;
  updateCount: number;
  sources: string[];
  days: string[];
}

const STATUSES = ["active", "dormant", "resolved"] as const;

export const load: PageServerLoad = async ({ url }) => {
  const statusFilter = url.searchParams.get("status") ?? "active";
  const search = url.searchParams.get("q") ?? "";

  const db = sql();
  const [rows, reportDates, counts] = await Promise.all([
    db`
      SELECT id, headline, domain, running_summary, first_seen::text AS first_seen,
             last_updated::text AS last_updated, status, update_count, sources
      FROM active_topics
      WHERE (${statusFilter} = 'all' OR status = ${statusFilter})
        AND (${search} = '' OR headline ILIKE ${"%" + search + "%"} OR running_summary ILIKE ${"%" + search + "%"})
      ORDER BY last_updated DESC, update_count DESC
      LIMIT 200
    `,
    db`SELECT report_date::text AS report_date FROM daily_reports ORDER BY report_date DESC LIMIT 120`,
    db`SELECT status, count(*)::int AS n FROM active_topics GROUP BY status`,
  ]);

  const allDays = (reportDates as unknown as { report_date: string }[]).map((row) => row.report_date);

  const topics: TopicRow[] = rows.map((row) => {
    const firstSeen = row.first_seen as string;
    const lastUpdated = row.last_updated as string;
    return {
      id: row.id as string,
      headline: row.headline as string,
      domain: row.domain as string,
      runningSummary: (row.running_summary as string | null) ?? null,
      firstSeen,
      lastUpdated,
      status: (row.status as string | null) ?? "active",
      updateCount: (row.update_count as number | null) ?? 1,
      sources: (row.sources as string[] | null) ?? [],
      days: allDays.filter((day) => day >= firstSeen && day <= lastUpdated),
    };
  });

  const byStatus = Object.fromEntries(
    (counts as unknown as { status: string; n: number }[]).map((row) => [row.status ?? "active", row.n]),
  );

  return {
    topics,
    statusFilter,
    search,
    counts: {
      all: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      active: byStatus.active ?? 0,
      dormant: byStatus.dormant ?? 0,
      resolved: byStatus.resolved ?? 0,
    },
  };
};

export const actions: Actions = {
  /**
   * Curation, not a rewrite. `active_topics` belongs to the pipeline and to Phase 6's
   * <!--SYSTEM--> parsing, and no skill may write it - the assistant cannot do this. Marking a
   * story resolved is the user's own judgement about what should stop appearing in tomorrow's
   * briefing, and this page is the only place it can be made.
   */
  setStatus: async ({ request }) => {
    const data = await request.formData();
    const id = (data.get("id") as string | null)?.trim();
    const status = data.get("status") as string | null;

    if (!id) return fail(400, { error: "Missing topic id" });
    if (!status || !(STATUSES as readonly string[]).includes(status)) return fail(400, { error: "Invalid status" });

    await sql()`UPDATE active_topics SET status = ${status} WHERE id = ${id}`;
    return { ok: true, id, status };
  },
};
