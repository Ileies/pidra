import { isUuid } from "$pipeline/util/ids";
import { readForm } from "#lib/server/form.js";
import type { Actions } from "./$types";
import { fail } from "@sveltejs/kit";
import { bridgeAction } from "#lib/server/bridge.js";

/** Moved from the parent page's actions: the revert button now lives only here. */
export const actions: Actions = {
  revertCorrection: async ({ request }) => {
    const id = (await readForm(request)).text("id");
    if (!isUuid(id)) return fail(400, { error: "Invalid correction id" });

    return bridgeAction(`/api/context/corrections/${id}/revert`, { method: "POST" }, (body: { message: string }) => ({ message: body.message }));
  },
};
