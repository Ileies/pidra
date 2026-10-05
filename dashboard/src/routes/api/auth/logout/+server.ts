import type { RequestHandler } from "./$types";
import { revokeSessionByToken, SESSION_COOKIE, SESSION_UI_COOKIE } from "#lib/server/auth.js";

// Revokes the server-side session and clears both cookies (the httpOnly session and the UI hint cookie).
export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await revokeSessionByToken(token);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  cookies.delete(SESSION_UI_COOKIE, { path: "/" });
  return Response.json({ ok: true });
};
