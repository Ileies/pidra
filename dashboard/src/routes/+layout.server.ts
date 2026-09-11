import type { LayoutServerLoad } from "./$types";
import { sql } from "$lib/db";

/**
 * Everything the navbar needs, loaded once. The navbar is on every page, so the badge counts
 * belong here rather than in each page's own load; page loads must not re-query them.
 *
 * The badges mark the two things that block: an open question gate, and a high-risk skill call
 * queued for confirmation (D4). Both are keyed by href so the navbar can render them from the
 * route registry without knowing what either one is.
 */
export const load: LayoutServerLoad = async () => {
  const db = sql();
  const [[pendingGate], [pendingSkills]] = await Promise.all([
    db`SELECT 1 FROM question_gate_sessions WHERE status = 'pending' LIMIT 1`,
    db`SELECT count(*)::int AS n FROM skill_executions WHERE status = 'pending'`,
  ]);

  const skills = (pendingSkills?.n as number | undefined) ?? 0;

  return {
    hasPendingQuestions: !!pendingGate,
    navBadges: {
      "/questions": pendingGate ? 1 : 0,
      "/skills": skills,
    } as Record<string, number>,
  };
};
