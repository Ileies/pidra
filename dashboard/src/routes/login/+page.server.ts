import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { hasCredentials } from "#lib/server/auth.js";

/**
 * The mirror image of `/setup`'s own redirect: nothing to log in with yet sends the reader to
 * bootstrap a passkey instead of a form that can only ever fail. The query is also what makes this
 * page need the connection like every other `ONLINE_ONLY` entry - without a load, the form would
 * render the same whether pronix answers or not, and the reader would tap into a hang.
 */
export const load: PageServerLoad = async () => {
  if (!(await hasCredentials())) redirect(303, "/setup");
};
