import type { LayoutServerLoad } from "./$types";
import { sql } from "$lib/db";

// The navbar is on every page, so the pending-question badge is loaded once here rather than in
// each page's own load. Page loads must not re-query it.
export const load: LayoutServerLoad = async () => {
  const [pendingGate] = await sql()`
    SELECT 1 FROM question_gate_sessions WHERE status = 'pending' LIMIT 1
  `;

  return { hasPendingQuestions: !!pendingGate };
};
