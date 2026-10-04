import { isUuid } from "$pipeline/util/ids";
import { errMessage } from "$pipeline/util/text";
import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { SKILLS_BRIDGE_URL } from "$app/env/private";

const API = SKILLS_BRIDGE_URL ?? "http://localhost:4000";

/** Moved from the parent page's actions: the revert button now lives only here. */
export const actions: Actions = {
  revertCorrection: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!isUuid(id)) return fail(400, { error: "Invalid correction id" });

    try {
      const res = await fetch(`${API}/api/context/corrections/${id}/revert`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) return fail(res.status, { error: body.error ?? "Revert failed" });
      return { message: body.message as string };
    } catch (err) {
      return fail(502, { error: `Skills bridge unreachable at ${API}: ${errMessage(err)}` });
    }
  },
};
