import type { PageServerLoad, Actions } from "./$types";
import { error, fail, redirect } from "@sveltejs/kit";
import { dev } from "$app/env";
import { AUTH_SETUP_TOKEN } from "$app/env/private";
import {
  hasCredentials,
  hasPin,
  listCredentials,
  listSessions,
  deleteCredential,
  revokeSessionById,
  issueBootstrap,
  AuthError,
  BOOTSTRAP_COOKIE,
} from "#lib/server/auth.js";

/**
 * Both the one-time bootstrap (register the first passkey + PIN, gated by `AUTH_SETUP_TOKEN`)
 * and the ongoing management page (add a second device, change the PIN, revoke a session) -
 * the setup token only ever opens the door once, since after that `hasCredentials()` is true and
 * every later visit needs `locals.session` instead.
 *
 * `dev` skips that "already bootstrapped" redirect: a WebAuthn credential is bound to the RP ID
 * it was created for, so the production `pidra.de` passkey can never authenticate a `localhost`
 * dev server - dev needs its own credential, and `hasCredentials()` isn't RP-scoped to tell the
 * two apart. Never true in a deployed build, so production keeps the one-time gate.
 */
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  if (!locals.session) {
    if (!dev && (await hasCredentials())) redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);

    const token = url.searchParams.get("token");
    if (!AUTH_SETUP_TOKEN || token !== AUTH_SETUP_TOKEN) error(404, "Not found");

    cookies.set(BOOTSTRAP_COOKIE, issueBootstrap(), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  }

  const [credentials, pinSet, sessions] = await Promise.all([
    listCredentials(),
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
      await deleteCredential(id);
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
