import type { RequestHandler } from "./$types";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { canManageAuth, listCredentials, rpConfig, storeChallenge, randomToken, BOOTSTRAP_COOKIE } from "#lib/server/auth.js";

export const POST: RequestHandler = async ({ locals, cookies }) => {
  if (!canManageAuth(locals.session, cookies.get(BOOTSTRAP_COOKIE))) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { rpID, rpName } = rpConfig();
  const existing = await listCredentials();
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
