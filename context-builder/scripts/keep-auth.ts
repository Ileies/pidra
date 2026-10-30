#!/usr/bin/env bun
/**
 * One-time Keep auth via browser oauth_token cookie exchange. Interactive; run by hand, locally and
 * again on pronix (`bun run keep-auth.js` in the app root).
 *
 * Steps:
 *   1. Open https://accounts.google.com/EmbeddedSetup in a browser while logged into the Google
 *      account for Keep.
 *   2. Click "I agree" (the page appears to hang - this is normal).
 *   3. DevTools -> Application -> Cookies -> accounts.google.com, copy the value of the
 *      "oauth_token" cookie (starts with oauth2_4/...).
 *   4. Run this script and paste the cookie value when prompted.
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { PROJECT_ROOT } from "../../src/config/data-dir";
import { defaultDeviceId } from "../sources/keep-api";
import { exchangeToken, fetchKeepAccessToken } from "../sources/keep-google-auth";
import { KEEP_TOKEN_PATH } from "../sources/keep";

/** Fixed id for the exchange, as the Python script used; the Keep fetch then presents its own device id. */
const EXCHANGE_ANDROID_ID = "aabbccddeeff00112233";

/** Fills missing env vars from the repo's `.env`, so the email is found whatever the cwd is. */
async function loadEnv(path: string): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  for (const raw of (await file.text()).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    process.env[key] ??= line.slice(eq + 1).trim();
  }
}

async function main(): Promise<number> {
  await loadEnv(resolve(PROJECT_ROOT, ".env"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = process.env.GKEEPAPI_EMAIL || (await rl.question("Google account email: ")).trim();
    const oauthToken = (await rl.question("Paste oauth_token cookie value from EmbeddedSetup: ")).trim();

    console.log("Exchanging token...");
    const res = await exchangeToken(email, oauthToken, EXCHANGE_ANDROID_ID);
    if (!res.Token) {
      console.log(`Token exchange failed: ${JSON.stringify(res)}`);
      return 1;
    }
    const masterToken = res.Token;

    console.log("Verifying against the Keep API...");
    try {
      await fetchKeepAccessToken(email, masterToken, defaultDeviceId());
    } catch (err) {
      console.log(`Authentication failed: ${err instanceof Error ? err.message : err}`);
      return 1;
    }

    await mkdir(dirname(KEEP_TOKEN_PATH), { recursive: true });
    await writeFile(KEEP_TOKEN_PATH, JSON.stringify({ email, master_token: masterToken }), { mode: 0o600 });
    await chmod(KEEP_TOKEN_PATH, 0o600); // `mode` is ignored when re-running over an existing file
    console.log(`Token saved to ${KEEP_TOKEN_PATH}`);
    console.log("On pronix, run `bun run deploy` afterwards: it hands the token to the pidra user.");
    console.log(`\nAdd to .env:\nGKEEPAPI_MASTER_TOKEN=${masterToken}`);
    return 0;
  } finally {
    rl.close();
  }
}

process.exit(await main());
