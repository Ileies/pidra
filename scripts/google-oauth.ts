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

// Google matches the redirect URI exactly against the Cloud console registration, hence the
// override (else redirect_uri_mismatch). The callback server below accepts any path on port 3333.
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3333";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const ENV_PATH = new URL("../.env", import.meta.url).pathname;

/** Replaces `key`'s line in .env or appends it; never duplicates (Bun keeps the last duplicate, humans read the first). */
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

// Read and write: the skills `add_calendar_event`, `add_todo_item` and `complete_todo_item` need
// insert/patch. Calendar is limited to events since creating one is the only write.
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
        // Google returns a refresh token only on a fresh consent (`prompt: "consent"` above); never write an empty one over a working one.
        throw new Error("Google returned no refresh_token - re-run and approve the consent screen.");
      }

      // Written to .env, never printed: a token in a terminal lands in scrollback and agent
      // transcripts and would need rotating.
      await upsertEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);

      console.log("\n=== SUCCESS ===");
      console.log(`GOOGLE_REFRESH_TOKEN written to ${ENV_PATH} (${tokens.refresh_token.length} chars).`);
      // No "revoke the old one" advice on purpose: revoking at myaccount.google.com/permissions kills
      // this client's whole grant, including the token just minted. Revoke before the flow.
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
