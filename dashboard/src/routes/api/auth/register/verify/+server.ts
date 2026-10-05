import type { RequestHandler } from "./$types";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { authManagerDenied, rpConfig, takeChallenge, addCredential } from "#lib/server/auth.js";
import { readJson } from "#lib/server/form.js";

// Passkey registration step 2: redeems the `nonce` challenge from `register/challenge` (single use),
// verifies the attestation and stores the credential.
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  const denied = authManagerDenied({ locals, cookies });
  if (denied) return denied;

  const body = await readJson<{ nonce: string; response: RegistrationResponseJSON; deviceLabel: string }>(request);
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
    rpId: rpID,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    deviceLabel: body.deviceLabel?.slice(0, 80),
    transports: credential.transports,
  });
  return Response.json({ ok: true });
};
