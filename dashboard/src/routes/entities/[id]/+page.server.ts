import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";

/**
 * The entity detail page's one write: the Watch control. Watching an entity sets
 * `importance = 'high'` through the same correction path `/contacts` uses - a field-level merge,
 * `previous_state` snapshot, row locked against a re-seed - because `importance` is one of the
 * fields `src/context/corrections.ts` already allows on an entity. `src/search/slots.ts`'s
 * monitoring slot reads watched entities directly, so this is the only UI that feeds it.
 *
 * Online-only for the same reason `/contacts` is: replayed later against a row that may have
 * moved, a locking merge on a stale base does lasting damage, so it is never queued offline.
 */

const API = process.env.SKILLS_BRIDGE_URL ?? "http://localhost:4000";

export const actions: Actions = {
  watch: async ({ request }) => {
    const data = await request.formData();
    const name = (data.get("name") as string | null)?.trim();
    const watched = data.get("watched") === "true";
    if (!name) return fail(400, { error: "Missing entity name" });

    try {
      const res = await fetch(`${API}/api/context/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_kind: "entity",
          target_key: name,
          operation: "amend",
          statement: watched
            ? `${name} is watched: surface it in the monitoring search slot even while it goes quiet.`
            : `${name} is no longer watched.`,
          fields: { importance: watched ? "high" : "normal" },
          source: "dashboard",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; applied?: string };
      if (!res.ok) return fail(res.status, { error: body.error ?? "The skills bridge returned an error." });
      return { ok: true, message: body.applied ?? (watched ? "Now watched." : "No longer watched.") };
    } catch {
      return fail(503, { error: "The skills bridge is not reachable (localhost:4000)." });
    }
  },
};
