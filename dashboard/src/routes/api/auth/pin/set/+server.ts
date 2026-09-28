import type { RequestHandler } from "./$types";
import { canManageAuth, setPin, AuthError, BOOTSTRAP_COOKIE } from "#lib/server/auth.js";

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!canManageAuth(locals.session, cookies.get(BOOTSTRAP_COOKIE))) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { pin?: string };
  try {
    await setPin(body.pin ?? "");
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
};
