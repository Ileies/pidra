import { sql } from "#lib/db.js";
import { parseJsonb } from "#lib/jsonb.js";

/**
 * Pulled out of +layout.server.ts. Kept as a real endpoint rather than a
 * request-scoped export because the root layout wraps every route: a server load there would force
 * a __data.json round trip on every client-side navigation, even to a mirrored page whose own load
 * has gone client-only, which defeats the one cached shell that boots any mirrored path offline.
 */
export const GET = async () => {
  const db = sql();
  // The same row `/questions` renders, counted the way it counts: its questions, not the number
  // of pending sessions, so the badge and the page heading cannot disagree.
  const [[gate], [pendingSkills]] = await Promise.all([
    db`SELECT questions FROM question_gate_sessions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    db`SELECT count(*)::int AS n FROM skill_executions WHERE status = 'pending'`,
  ]);

  const questions = gate ? parseJsonb<unknown[]>(gate.questions, []).length : 0;
  const skills = (pendingSkills?.n as number | undefined) ?? 0;

  return Response.json({
    hasPendingQuestions: questions > 0,
    navBadges: { "/questions": questions, "/skills": skills } as Record<string, number>,
  });
};
