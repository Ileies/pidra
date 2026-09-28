import type { RequestHandler } from "./$types";
import { revokeSessionByToken, SESSION_COOKIE, SESSION_UI_COOKIE } from "#lib/server/auth.js";

export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await revokeSessionByToken(token);
  cookies.delete(SESSION_COOKIE, { path: "/" });
  cookies.delete(SESSION_UI_COOKIE, { path: "/" });
  return Response.json({ ok: true });
};
