import type { RequestHandler } from "./$types";
import { authManagerDenied, setPin, AuthError } from "#lib/server/auth.js";
import { readJson } from "#lib/server/form.js";

// Sets or replaces the login PIN (called from /setup). `authManagerDenied` gates it to a
// logged-in session or the /setup bootstrap window; validation errors come back as `AuthError` -> 400.
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const denied = authManagerDenied({ locals, cookies });
  if (denied) return denied;

  const body = await readJson<{ pin: string }>(request);
  try {
    await setPin(body.pin ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};
