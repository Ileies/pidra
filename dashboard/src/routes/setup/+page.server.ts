import type { PageServerLoad, Actions } from "./$types";
import { error, fail, redirect } from "@sveltejs/kit";
import { AUTH_SETUP_TOKEN } from "$app/env/private";
import {
  hasCredentials,
  hasPin,
  listCredentials,
  listSessions,
  deleteCredential,
  revokeSessionById,
  issueBootstrap,
  rpConfig,
  AuthError,
  BOOTSTRAP_COOKIE,
  setAuthCookie,
} from "#lib/server/auth.js";

/**
 * Both the one-time bootstrap (register the first passkey + PIN, gated by `AUTH_SETUP_TOKEN`)
 * and the ongoing management page (add a second device, change the PIN, revoke a session) - the
 * setup token only ever opens the door once per RP ID, since after that `hasCredentials(rpID)`
 * is true for this origin and every later visit needs `locals.session` instead. `hasCredentials`
 * is scoped to the current `rpID` (`auth_credentials.rp_id`) because dev (`localhost`) and prod
 * (`pidra.de`) share this table - a credential bound to one RP ID can never authenticate the
 * other, so a fresh dev environment still gets its own one-time bootstrap even once prod is set up.
 */
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  const { rpID } = rpConfig();

  if (!locals.session) {
    if (await hasCredentials(rpID)) redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);

    const token = url.searchParams.get("token");
    if (!AUTH_SETUP_TOKEN || token !== AUTH_SETUP_TOKEN) error(404, "Not found");

    setAuthCookie(cookies, BOOTSTRAP_COOKIE, issueBootstrap(), 600);
  }

  const [credentials, pinSet, sessions] = await Promise.all([
    listCredentials(rpID),
    hasPin(),
    locals.session ? listSessions() : Promise.resolve([]),
  ]);
  return { credentials, pinSet, sessions, bootstrapping: !locals.session };
};

export const actions: Actions = {
  deleteCredential: async ({ request, locals }) => {
    if (!locals.session) return fail(401, { error: "Log in first." });
    const data = await request.formData();
    const id = (data.get("id") as string | null) ?? "";
    try {
      await deleteCredential(id, rpConfig().rpID);
      return { ok: true, message: "Passkey removed." };
    } catch (err) {
      if (err instanceof AuthError) return fail(400, { error: err.message });
      throw err;
    }
  },

  revokeSession: async ({ request, locals }) => {
    if (!locals.session) return fail(401, { error: "Log in first." });
    const data = await request.formData();
    const id = (data.get("id") as string | null) ?? "";
    await revokeSessionById(id);
    return { ok: true, message: "Session signed out." };
  },
};
