import type { Actions } from "./$types";
import { readForm } from "#lib/server/form.js";
import { fail } from "@sveltejs/kit";
import { bridgeAction, jsonPost } from "#lib/server/bridge.js";

/**
 * The entity detail page's one write (`watch`). Watching an entity sets
 * `importance = 'high'` through the same correction path `/contacts` uses - a field-level merge,
 * `previous_state` snapshot, row locked against a re-seed - because `importance` is one of the
 * fields `src/context/corrections.ts` already allows on an entity. `src/search/slots.ts`'s
 * monitoring slot reads watched entities directly, so this is the only UI that feeds it.
 *
 * Online-only for the same reason `/contacts` is: replayed later against a row that may have
 * moved, a locking merge on a stale base does lasting damage, so it is never queued offline.
 */

export const actions: Actions = {
  watch: async ({ request }) => {
    const form = await readForm(request);
    const name = form.text("name");
    const watched = form.flag("watched");
    if (!name) return fail(400, { error: "Missing entity name" });

    return bridgeAction(
      "/api/context/corrections",
      jsonPost({
        target_kind: "entity",
        target_key: name,
        operation: "amend",
        statement: watched
          ? `${name} is watched: surface it in the monitoring search slot even while it goes quiet.`
          : `${name} is no longer watched.`,
        fields: { importance: watched ? "high" : "normal" },
        source: "dashboard",
      }),
      (body: { applied?: string }) => ({ ok: true, message: body.applied ?? (watched ? "Now watched." : "No longer watched.") }),
    );
  },
};
