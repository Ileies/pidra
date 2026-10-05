import type { RequestHandler } from "./$types";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { authManagerDenied, listCredentials, rpConfig, storeChallenge, randomToken } from "#lib/server/auth.js";

// Passkey registration step 1 (from /setup): returns WebAuthn options plus a `nonce` that keys the
// server-held challenge; `register/verify` redeems it once. Existing credentials are excluded.
export const POST: RequestHandler = async ({ locals, cookies }) => {
  const denied = authManagerDenied({ locals, cookies });
  if (denied) return denied;

  const { rpID, rpName } = rpConfig();
  const existing = await listCredentials(rpID);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: "pidra",
    userDisplayName: "PIDRA",
    userID: new TextEncoder().encode("pidra-owner"),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const nonce = randomToken();
  storeChallenge(nonce, options.challenge);
  return Response.json({ options, nonce });
};
