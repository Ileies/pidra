import { sql } from "#lib/server/postgres.js";

/**
 * Pulled out of +layout.server.ts. Kept as a real endpoint rather than a
 * request-scoped export because the root layout wraps every route: a server load there would force
 * a __data.json round trip on every client-side navigation, even to a mirrored page whose own load
 * has gone client-only, which defeats the one cached shell that boots any mirrored path offline.
 */
export const GET = async () => {
  const db = sql();
  // Questions are counted the same way `/questions` counts its heading, so the two cannot disagree.
  // Reports and runs are projections with an acknowledgement row, not mutable notification copies.
  const [[openQuestions], [pendingSkills], [unreadReports], [unreviewedRuns]] = await Promise.all([
    db`SELECT count(*)::int AS n FROM questions WHERE status = 'open'`,
    db`SELECT count(*)::int AS n FROM skill_executions WHERE status = 'pending'`,
    db`
      SELECT count(*)::int AS n
      FROM daily_reports d
      LEFT JOIN notification_reads n ON n.notification_key = 'report:' || d.report_date::text
      WHERE n.notification_key IS NULL
    `,
    db`
      SELECT count(*)::int AS n
      FROM pipeline_runs r
      LEFT JOIN notification_reads n ON n.notification_key = 'run:' || r.id::text
      WHERE n.notification_key IS NULL
        AND (r.status = 'failed' OR COALESCE(jsonb_array_length(r.step_errors), 0) > 0)
    `,
  ]);

  const questions = (openQuestions?.n as number | undefined) ?? 0;
  const skills = (pendingSkills?.n as number | undefined) ?? 0;
  const reports = (unreadReports?.n as number | undefined) ?? 0;
  const runs = (unreviewedRuns?.n as number | undefined) ?? 0;

  return Response.json({
    hasPendingQuestions: questions > 0,
    navBadges: { "/": reports, "/questions": questions, "/runs": runs, "/skills": skills } as Record<string, number>,
  });
};
