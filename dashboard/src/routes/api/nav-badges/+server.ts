import { sql } from "#lib/db.js";

/**
 * Pulled out of +layout.server.ts (OFFLINE_PLAN.md O2). Kept as a real endpoint rather than a
 * request-scoped export because the root layout wraps every route: a server load there would force
 * a __data.json round trip on every client-side navigation, even to a Tier A page whose own load
 * has gone client-only, which defeats decision 1 (one cached shell booting any Tier A path offline).
 */
export const GET = async () => {
  const db = sql();
  const [[pendingGate], [pendingSkills]] = await Promise.all([
    db`SELECT 1 FROM question_gate_sessions WHERE status = 'pending' LIMIT 1`,
    db`SELECT count(*)::int AS n FROM skill_executions WHERE status = 'pending'`,
  ]);

  const skills = (pendingSkills?.n as number | undefined) ?? 0;

  return Response.json({
    hasPendingQuestions: !!pendingGate,
    navBadges: { "/questions": pendingGate ? 1 : 0, "/skills": skills } as Record<string, number>,
  });
};
