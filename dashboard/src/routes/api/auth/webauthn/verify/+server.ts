import type { RequestHandler } from "./$types";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  ipLocked,
  recordIpFailure,
  clearIpFailures,
  rpConfig,
  takeChallenge,
  findCredentialByCredentialId,
  touchCredential,
  issuePkv,
  PKV_COOKIE,
} from "#lib/server/auth.js";

/** Login step 2: the passkey assertion. Success only starts the PIN step - no session yet. */
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  const ip = getClientAddress();
  if (ipLocked(ip)) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { nonce?: string; response?: AuthenticationResponseJSON };
  const challenge = takeChallenge(body.nonce ?? "");
  if (!challenge || !body.response) return Response.json({ error: "Challenge expired. Try again." }, { status: 400 });

  const { rpID, origin } = rpConfig();
  const credential = await findCredentialByCredentialId(body.response.id, rpID);
  if (!credential) {
    recordIpFailure(ip);
    return Response.json({ error: "Unrecognised passkey." }, { status: 401 });
  }

  const verified = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.credentialId,
      publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
      counter: credential.counter,
      transports: credential.transports ?? undefined,
    },
  }).catch(() => null);

  if (!verified?.verified) {
    recordIpFailure(ip);
    return Response.json({ error: "Passkey verification failed." }, { status: 401 });
  }

  await touchCredential(credential.id, verified.authenticationInfo.newCounter);
  clearIpFailures(ip);
  cookies.set(PKV_COOKIE, issuePkv(credential.id), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 300 });
  return Response.json({ ok: true });
};
