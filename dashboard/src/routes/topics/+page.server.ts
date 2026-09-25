import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/db.js";

/**
 * Topic curation, online-only. The read side moved to `+page.ts`.
 */

const STATUSES = ["active", "dormant", "resolved"] as const;

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
