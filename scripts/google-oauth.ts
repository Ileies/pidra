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

// Desktop App credentials use localhost as redirect
const REDIRECT_URI = "http://localhost:3333";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks.readonly",
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

      console.log("\n=== SUCCESS ===");
      console.log("Add this to your .env:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);

      setTimeout(() => { server.stop(); process.exit(0); }, 300);

      return new Response(
        "<html><body><h2>Done! Check your terminal for the refresh token.</h2></body></html>",
        { headers: { "Content-Type": "text/html" } }
      );
    } catch (err) {
      console.error("\nFailed to exchange code:", err);
      setTimeout(() => { server.stop(); process.exit(1); }, 300);
      return new Response("Token exchange failed - check terminal.", { status: 500 });
    }
  },
});
