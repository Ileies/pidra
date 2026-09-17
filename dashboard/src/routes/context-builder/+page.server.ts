import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** Actions only. The read side moved to `+page.ts` (OFFLINE_PLAN.md O2); see `[date]/+page.server.ts`
 *  for why a co-located `load` here would never run for a client-side navigation now. */
export const actions: Actions = {
  revertCorrection: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!(/^[0-9a-f-]{36}$/i).test(id)) return fail(400, { error: "Invalid correction id" });

    try {
      const res = await fetch(`${API}/api/context/corrections/${id}/revert`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) return fail(res.status, { error: body.error ?? "Revert failed" });
      return { message: body.message as string };
    } catch (err) {
      return fail(502, { error: `Skills bridge unreachable at ${API}: ${err instanceof Error ? err.message : String(err)}` });
    }
  },
};
