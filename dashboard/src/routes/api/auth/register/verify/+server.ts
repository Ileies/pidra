import type { RequestHandler } from "./$types";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { canManageAuth, rpConfig, takeChallenge, addCredential, BOOTSTRAP_COOKIE } from "#lib/server/auth.js";

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!canManageAuth(locals.session, cookies.get(BOOTSTRAP_COOKIE))) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    nonce?: string;
    response?: RegistrationResponseJSON;
    deviceLabel?: string;
  };
  const challenge = takeChallenge(body.nonce ?? "");
  if (!challenge || !body.response) return Response.json({ error: "Challenge expired. Try again." }, { status: 400 });

  const { rpID, origin } = rpConfig();
  const verified = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch(() => null);

  if (!verified?.verified) return Response.json({ error: "Registration failed." }, { status: 400 });

  const { credential } = verified.registrationInfo;
  await addCredential({
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    deviceLabel: body.deviceLabel?.slice(0, 80),
    transports: credential.transports,
  });
  return Response.json({ ok: true });
};
