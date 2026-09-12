#!/usr/bin/env bun
/**
 * One-time Google OAuth flow to obtain a refresh token for Calendar + Tasks.
 * Run: bun scripts/google-oauth.ts
 * Then paste GOOGLE_REFRESH_TOKEN into .env
 */

import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

// Desktop App credentials use localhost as redirect. Google matches this string exactly against
// what is registered in the Cloud console, so it is overridable: the callback server below accepts
// any path, and a project registered as .../oauth/callback would otherwise fail the flow with
// redirect_uri_mismatch before the consent screen ever appears.
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3333";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const ENV_PATH = new URL("../.env", import.meta.url).pathname;

/**
 * Replaces `key`'s line in .env, or appends it if the key is absent. Rewrites the file rather than
 * appending blindly, because a duplicate key is ambiguous: Bun's loader keeps the last occurrence
 * and a human reading the file usually reads the first.
 */
async function upsertEnv(key: string, value: string): Promise<void> {
  const file = Bun.file(ENV_PATH);
  const before = (await file.exists()) ? await file.text() : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const after = pattern.test(before)
    ? before.replace(pattern, line)
    : `${before}${before.endsWith("\n") || before === "" ? "" : "\n"}${line}\n`;
  await Bun.write(ENV_PATH, after);
}

// Read *and* write. The pipeline only reads, but `add_calendar_event`, `add_todo_item` and
// `complete_todo_item` all call insert/patch, and with the readonly scopes this script used to
// request they could never have succeeded - the grant simply did not cover them. Calendar is
// scoped to events rather than the full calendar: creating an event is the only write there is.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for callback on http://localhost:3333 ...\n");

const server = Bun.serve({
  port: 3333,
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      console.error(`\nOAuth error: ${error}`);
      setTimeout(() => { server.stop(); process.exit(1); }, 200);
      return new Response(`<html><body><h2>Error: ${error}</h2></body></html>`, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (!code) {
      return new Response("Waiting...", { status: 200 });
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        // Google only returns a refresh token when the grant is actually re-consented. Without
        // `prompt: "consent"` above an already-authorised account silently yields an access token
        // and nothing else, which used to write an empty value over a working one.
        throw new Error("Google returned no refresh_token - re-run and approve the consent screen.");
      }

      // Written straight into .env rather than printed. A refresh token that reaches a terminal
      // ends up in scrollback, in shell history if it is copied around, and in the transcript of
      // any agent watching that terminal - at which point it has to be rotated before it is even
      // used. The file is gitignored and is the only place this value belongs.
      await upsertEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

      console.log("\n=== SUCCESS ===");
      console.log(`GOOGLE_REFRESH_TOKEN written to ${ENV_PATH} (${tokens.refresh_token.length} chars).`);
      // Deliberately not "now go revoke the old one": removing the app at
      // myaccount.google.com/permissions revokes the whole grant for this client, which would kill
      // the token this run just minted. Revoking belongs *before* the flow, not after.
      console.log("The value was not printed.\n");

      setTimeout(() => { server.stop(); process.exit(0); }, 300);

      return new Response(
        "<html><body><h2>Done! The refresh token was written to .env.</h2></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    } catch (err) {
      console.error("\nFailed to exchange code:", err);
      setTimeout(() => { server.stop(); process.exit(1); }, 300);
      return new Response("Token exchange failed - check terminal.", { status: 500 });
    }
  },
});
