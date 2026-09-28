import type { RequestHandler } from "./$types";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { ipLocked, rpConfig, storeChallenge, randomToken } from "#lib/server/auth.js";

/** Login step 1: no `allowCredentials` - any resident passkey Bitwarden holds for this RP may answer. */
export const POST: RequestHandler = async ({ getClientAddress }) => {
  if (ipLocked(getClientAddress())) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  const { rpID } = rpConfig();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const nonce = randomToken();
  storeChallenge(nonce, options.challenge);
  return Response.json({ options, nonce });
};
