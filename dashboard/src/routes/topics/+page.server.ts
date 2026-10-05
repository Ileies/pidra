import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";

// Topic curation write (`setStatus`), online-only. The read side is `+page.ts` (mirrored).

const STATUSES = ["active", "dormant", "archived", "resolved"] as const;

export const actions: Actions = {
  /**
   * Curation, not a rewrite. `active_topics` belongs to the pipeline and to Phase 6's
   * <!--SYSTEM--> parsing, and no skill may write it - the assistant cannot do this. Marking a
   * story resolved is the user's own judgement about what should stop appearing in tomorrow's
   * briefing, and this page is the only place it can be made.
   */
  setStatus: async ({ request }) => {
    const form = await readForm(request);
    const id = form.text("id");
    const status = form.text("status");

    if (!id) return fail(400, { error: "Missing topic id" });
    if (!status || !(STATUSES as readonly string[]).includes(status)) return fail(400, { error: "Invalid status" });

    if (!isUuid(id)) {
      return fail(400, { error: "Invalid topic id" });
    }
    await sql()`UPDATE active_topics SET status = ${status},
      last_updated = CASE WHEN ${status} = 'active' THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date ELSE last_updated END
      WHERE id = ${id}`;
    return { ok: true, id, status };
  },
};
