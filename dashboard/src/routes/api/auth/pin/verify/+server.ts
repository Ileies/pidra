import type { RequestHandler } from "./$types";
import {
  ipLocked,
  recordIpFailure,
  clearIpFailures,
  checkPkv,
  recordPkvAttempt,
  consumePkv,
  verifyPin,
  createSession,
  PKV_COOKIE,
  SESSION_COOKIE,
  SESSION_UI_COOKIE,
  setAuthCookie,
} from "#lib/server/auth.js";
import { readJson } from "#lib/server/form.js";

/** Login step 3: the PIN, only reachable with a still-live passkey-verified cookie. */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const ip = getClientAddress();
  if (ipLocked(ip)) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const nonce = cookies.get(PKV_COOKIE);
  const entry = checkPkv(nonce);
  if (!entry) return Response.json({ error: "Passkey step expired. Start over." }, { status: 401 });

  const body = await readJson<{ pin: string }>(request);
  const ok = await verifyPin(body.pin ?? "");
  if (!ok) {
    recordPkvAttempt(nonce!);
    recordIpFailure(ip);
    return Response.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  consumePkv(nonce!);
  clearIpFailures(ip);
  cookies.delete(PKV_COOKIE, { path: "/" });
  const token = await createSession(request.headers.get("user-agent"));
  const maxAge = 60 * 60 * 24 * 30;
  setAuthCookie(cookies, SESSION_COOKIE, token, maxAge);
  setAuthCookie(cookies, SESSION_UI_COOKIE, "1", maxAge, false);
  return Response.json({ ok: true });
};
