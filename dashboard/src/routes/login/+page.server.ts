import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { hasCredentials, rpConfig } from "#lib/server/auth.js";

/**
 * Mirror image of `/setup`'s redirect: no credentials yet sends the reader to bootstrap a passkey.
 * The query is also what makes this page need the connection like every other `ONLINE_ONLY` entry
 * (without a load the form would render the same offline and the tap would hang).
 *
 * Scoped to the current `rpID`: dev (`localhost`) and prod share `auth_credentials`, so an
 * unscoped check would see prod's passkey and never bootstrap dev.
 */
export const load: PageServerLoad = async () => {
  if (!(await hasCredentials(rpConfig().rpID))) redirect(303, "/setup");
};
