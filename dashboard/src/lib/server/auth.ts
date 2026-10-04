/**
 * Login: a WebAuthn passkey assertion, then a PIN - in that order, since the PIN is only ever
 * checked once a passkey has already succeeded (`src/routes/api/auth/pin/verify`). The single
 * writer for `auth_credentials`, `auth_pin` and `auth_sessions`, the same shape as `rules.ts`:
 * a domain `AuthError`, no raw SQL outside this file.
 *
 * WebAuthn challenges and PIN attempt counters live in the two module-level maps below rather
 * than in a table - this is one long-running Bun process (`shutdown.ts` already assumes as much),
 * and losing them on a restart just forces a fresh login, which is fine.
 */

import type { Cookies } from "@sveltejs/kit";
import { sql } from "#lib/server/postgres.js";
import { AUTH_RP_ID, AUTH_ORIGIN } from "$app/env/private";

export class AuthError extends Error {}

const SESSION_COOKIE = "pidra_session";
/**
 * A companion to `SESSION_COOKIE`, deliberately not `httpOnly`: the root layout reads it
 * client-side to decide whether to render the navbar, so that decision never costs a server round
 * trip (CLAUDE.md, offline mode - "no load waits on the network" applies to every mirrored route,
 * which a `+layout.server.ts` would have violated for all of them at once). It carries no
 * authority - `hooks.server.ts` is still what gates every route - so a spoofed value only ever
 * shows a navbar the server would then refuse to serve behind.
 */
const SESSION_UI_COOKIE = "pidra_ui";
const PKV_COOKIE = "pidra_pkv";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TOUCH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // only rewrite once a day
const PKV_TTL_MS = 5 * 60 * 1000; // the PIN step must follow the passkey step within 5 minutes
const CHALLENGE_TTL_MS = 60 * 1000;
const PIN_MAX_ATTEMPTS = 5;
const IP_LOCKOUT_THRESHOLD = 10;
const IP_LOCKOUT_BASE_MS = 15 * 60 * 1000;

const BOOTSTRAP_COOKIE = "pidra_bootstrap";
const BOOTSTRAP_TTL_MS = 10 * 60 * 1000;

export { SESSION_COOKIE, SESSION_UI_COOKIE, PKV_COOKIE, BOOTSTRAP_COOKIE };

/** The relying-party identity, shared by every WebAuthn call. */
export function rpConfig(): { rpID: string; rpName: string; origin: string } {
  const rpID = AUTH_RP_ID ?? "pidra.de";
  return { rpID, rpName: "PIDRA", origin: AUTH_ORIGIN ?? `https://${rpID}` };
}

// --- credentials ---

export interface CredentialRow {
  id: string;
  credentialId: string;
  rpId: string;
  publicKey: string;
  counter: number;
  deviceLabel: string | null;
  transports: string[] | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Scoped to `rpID`: dev (`localhost`) and prod (`pidra.de`) share this table (same
 * `DATABASE_URL`), and a credential bound to one RP ID can never authenticate the other, so an
 * unscoped read would mix the two - `excludeCredentials` would list a credential Bitwarden has
 * never heard of for this origin, and `hasCredentials`/`findCredentialByCredentialId` would count
 * or match rows for a WebAuthn identity the current origin isn't allowed to touch.
 */
export async function listCredentials(rpID: string): Promise<CredentialRow[]> {
  const rows = await sql()<CredentialRow[]>`
    SELECT id, credential_id AS "credentialId", rp_id AS "rpId", public_key AS "publicKey", counter,
           device_label AS "deviceLabel", transports, created_at AS "createdAt", last_used_at AS "lastUsedAt"
    FROM auth_credentials WHERE rp_id = ${rpID} ORDER BY created_at ASC`;
  return rows;
}

export async function hasCredentials(rpID: string): Promise<boolean> {
  const [row] = await sql()`SELECT 1 FROM auth_credentials WHERE rp_id = ${rpID} LIMIT 1`;
  return !!row;
}

export async function findCredentialByCredentialId(credentialId: string, rpID: string): Promise<CredentialRow | null> {
  const [row] = await sql()<CredentialRow[]>`
    SELECT id, credential_id AS "credentialId", rp_id AS "rpId", public_key AS "publicKey", counter,
           device_label AS "deviceLabel", transports, created_at AS "createdAt", last_used_at AS "lastUsedAt"
    FROM auth_credentials WHERE credential_id = ${credentialId} AND rp_id = ${rpID} LIMIT 1`;
  return row ?? null;
}

export async function addCredential(input: {
  credentialId: string;
  rpId: string;
  publicKey: string;
  counter: number;
  deviceLabel?: string;
  transports?: string[];
}): Promise<void> {
  await sql()`
    INSERT INTO auth_credentials (credential_id, rp_id, public_key, counter, device_label, transports)
    VALUES (${input.credentialId}, ${input.rpId}, ${input.publicKey}, ${input.counter}, ${input.deviceLabel ?? null}, ${sql().json(input.transports ?? [])})`;
}

export async function touchCredential(id: string, counter: number): Promise<void> {
  await sql()`UPDATE auth_credentials SET counter = ${counter}, last_used_at = now() WHERE id = ${id}`;
}

export async function deleteCredential(id: string, rpID: string): Promise<void> {
  const remaining = await sql()`SELECT count(*) AS n FROM auth_credentials WHERE id != ${id} AND rp_id = ${rpID}`;
  if (Number(remaining[0]?.n ?? 0) === 0) {
    throw new AuthError("Can't remove the last passkey - you would be locked out.");
  }
  await sql()`DELETE FROM auth_credentials WHERE id = ${id} AND rp_id = ${rpID}`;
}

// --- PIN ---

export async function hasPin(): Promise<boolean> {
  const [row] = await sql()`SELECT 1 FROM auth_pin LIMIT 1`;
  return !!row;
}

export async function setPin(rawPin: string): Promise<void> {
  if (!/^\d{6,10}$/.test(rawPin)) throw new AuthError("PIN must be 6-10 digits.");
  const pinHash = await Bun.password.hash(rawPin, { algorithm: "argon2id" });
  await sql().begin(async (tx) => {
    await tx`DELETE FROM auth_pin`;
    await tx`INSERT INTO auth_pin (pin_hash) VALUES (${pinHash})`;
  });
}

export async function verifyPin(rawPin: string): Promise<boolean> {
  const [row] = await sql()<{ pinHash: string }[]>`SELECT pin_hash AS "pinHash" FROM auth_pin LIMIT 1`;
  if (!row) return false;
  return Bun.password.verify(rawPin, row.pinHash);
}

// --- sessions ---

async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Buffer.from(digest).toString("hex");
}

export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export interface SessionRow {
  id: string;
  createdAt: string | null;
  expiresAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
}

export async function createSession(userAgent: string | null): Promise<string> {
  const raw = randomToken();
  const id = await hashToken(raw);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await sql()`INSERT INTO auth_sessions (id, expires_at, last_seen_at, user_agent) VALUES (${id}, ${expiresAt}, now(), ${userAgent})`;
  return raw;
}

/** Validates the raw cookie value; touches `last_seen_at` at most once a day. */
export async function validateSession(rawToken: string | undefined): Promise<{ id: string } | null> {
  if (!rawToken) return null;
  const id = await hashToken(rawToken);
  const [row] = await sql()<SessionRow[]>`
    SELECT id, created_at AS "createdAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", user_agent AS "userAgent"
    FROM auth_sessions WHERE id = ${id} AND expires_at > now() LIMIT 1`;
  if (!row) return null;
  const lastSeen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (Date.now() - lastSeen > SESSION_TOUCH_MIN_INTERVAL_MS) {
    await sql()`UPDATE auth_sessions SET last_seen_at = now() WHERE id = ${id}`;
  }
  return { id: row.id };
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  await sql()`DELETE FROM auth_sessions WHERE id = ${await hashToken(rawToken)}`;
}

export async function revokeSessionById(id: string): Promise<void> {
  await sql()`DELETE FROM auth_sessions WHERE id = ${id}`;
}

export async function listSessions(): Promise<SessionRow[]> {
  return sql()<SessionRow[]>`
    SELECT id, created_at AS "createdAt", expires_at AS "expiresAt", last_seen_at AS "lastSeenAt", user_agent AS "userAgent"
    FROM auth_sessions WHERE expires_at > now() ORDER BY last_seen_at DESC NULLS LAST`;
}

// --- WebAuthn challenges (in-memory, single-use, short-lived) ---

interface StoredChallenge {
  challenge: string;
  expiresAt: number;
}

const challenges = new Map<string, StoredChallenge>();

export function storeChallenge(nonce: string, challenge: string): void {
  sweep(challenges);
  challenges.set(nonce, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

export function takeChallenge(nonce: string): string | null {
  const entry = challenges.get(nonce);
  challenges.delete(nonce);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

// --- passkey-verified cookie value (opaque nonce -> which credential passed) ---

interface PkvEntry {
  credentialId: string;
  expiresAt: number;
  attempts: number;
}

const pkvStore = new Map<string, PkvEntry>();

export function issuePkv(credentialId: string): string {
  sweep(pkvStore);
  const nonce = randomToken();
  pkvStore.set(nonce, { credentialId, expiresAt: Date.now() + PKV_TTL_MS, attempts: 0 });
  return nonce;
}

/** Returns the entry if the nonce is live and under the per-nonce attempt cap, else null. */
export function checkPkv(nonce: string | undefined): PkvEntry | null {
  if (!nonce) return null;
  const entry = pkvStore.get(nonce);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) pkvStore.delete(nonce);
    return null;
  }
  if (entry.attempts >= PIN_MAX_ATTEMPTS) return null;
  return entry;
}

export function recordPkvAttempt(nonce: string): void {
  const entry = pkvStore.get(nonce);
  if (entry) entry.attempts += 1;
}

export function consumePkv(nonce: string): void {
  pkvStore.delete(nonce);
}

// --- one-time bootstrap: the setup token only ever opens the door once ---

const bootstrapNonces = new Map<string, { expiresAt: number }>();

/** Called once, when `/setup` sees a matching `AUTH_SETUP_TOKEN` and zero credentials exist. */
export function issueBootstrap(): string {
  sweep(bootstrapNonces);
  const nonce = randomToken();
  bootstrapNonces.set(nonce, { expiresAt: Date.now() + BOOTSTRAP_TTL_MS });
  return nonce;
}

function checkBootstrap(nonce: string | undefined): boolean {
  if (!nonce) return false;
  const entry = bootstrapNonces.get(nonce);
  return !!entry && entry.expiresAt >= Date.now();
}

/** True once logged in, or during the one-time bootstrap window `/setup`'s `load` opened. */
function canManageAuth(session: { id: string } | null, bootstrapNonce: string | undefined): boolean {
  return !!session || checkBootstrap(bootstrapNonce);
}

// --- per-IP lockout, defense in depth on top of the pkv attempt cap above ---

interface IpAttempts {
  failures: number;
  lockedUntil: number;
  lockCount: number;
}

const ipAttempts = new Map<string, IpAttempts>();

export function ipLocked(ip: string): boolean {
  const entry = ipAttempts.get(ip);
  return !!entry && entry.lockedUntil > Date.now();
}

export function recordIpFailure(ip: string): void {
  const entry = ipAttempts.get(ip) ?? { failures: 0, lockedUntil: 0, lockCount: 0 };
  entry.failures += 1;
  if (entry.failures >= IP_LOCKOUT_THRESHOLD) {
    entry.lockCount += 1;
    entry.lockedUntil = Date.now() + IP_LOCKOUT_BASE_MS * 2 ** (entry.lockCount - 1);
    entry.failures = 0;
  }
  ipAttempts.set(ip, entry);
}

export function clearIpFailures(ip: string): void {
  ipAttempts.delete(ip);
}

function sweep<K, V extends { expiresAt: number }>(map: Map<K, V>): void {
  if (map.size < 1000) return; // only worth the pass once it could matter
  const now = Date.now();
  for (const [key, value] of map) if (value.expiresAt < now) map.delete(key);
}

/** The 401 a route returns unless the caller is logged in or inside the `/setup` bootstrap window. */
export function authManagerDenied(event: { locals: App.Locals; cookies: Cookies }): Response | null {
  if (canManageAuth(event.locals.session, event.cookies.get(BOOTSTRAP_COOKIE))) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** A login-flow cookie: always `secure`, `lax`, site-wide; `httpOnly` unless the UI has to read it. */
export function setAuthCookie(cookies: Cookies, name: string, value: string, maxAge: number, httpOnly = true): void {
  cookies.set(name, value, { httpOnly, secure: true, sameSite: "lax", path: "/", maxAge });
}
