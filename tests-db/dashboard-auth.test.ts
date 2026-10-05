// dashboard/src/lib/server/auth.ts against real SQL: sessions stored only as hashes and expiring,
// the PIN, passkey rows scoped to one relying party, the single-use challenge, the passkey-verified
// cookie with its attempt cap, the per-IP lockout and the bootstrap window. Time is moved by
// replacing Date.now for the in-memory parts and by rewriting rows for the stored ones.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { fakeCookies, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
setPrivateEnv();
const auth = await import("../dashboard/src/lib/server/auth");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

let clock: ReturnType<typeof spyOn<DateConstructor, "now">> | null = null;
function advance(ms: number) {
  clock?.mockRestore();
  const base = Date.now();
  clock = spyOn(Date, "now").mockReturnValue(base + ms);
}

beforeEach(async () => {
  await database.sql`truncate auth_sessions, auth_credentials, auth_pin cascade`;
});
afterEach(() => {
  clock?.mockRestore();
  clock = null;
});

describe("sessions", () => {
  test("the cookie value is a random token and only its SHA-256 is stored", async () => {
    const token = await auth.createSession("Mozilla/5.0 test");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await auth.createSession(null)).not.toBe(token);

    const rows = await database.sql`select id, user_agent, expires_at > now() + interval '29 days' as long_lived from auth_sessions order by created_at`;
    expect(rows[0]).toMatchObject({ id: sha256(token), user_agent: "Mozilla/5.0 test", long_lived: true });
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("validates the live token and nothing else", async () => {
    const token = await auth.createSession(null);
    expect(await auth.validateSession(token)).toEqual({ id: sha256(token) });
    for (const bad of [undefined, "", "wrong", token.slice(1), `${token}x`, sha256(token)]) {
      expect(await auth.validateSession(bad)).toBeNull();
    }
  });

  test("a session past its expiry is refused and one revoked by token or by id is gone", async () => {
    const [a, b, c] = [await auth.createSession(null), await auth.createSession(null), await auth.createSession(null)];
    await database.sql`update auth_sessions set expires_at = now() - interval '1 second' where id = ${sha256(a)}`;
    await auth.revokeSessionByToken(b);
    await auth.revokeSessionById(sha256(c));

    for (const token of [a, b, c]) expect(await auth.validateSession(token)).toBeNull();
    expect(await auth.listSessions()).toEqual([]);
  });

  test("last_seen_at is rewritten at most once a day", async () => {
    const token = await auth.createSession(null);
    const seen = async () => (await database.sql`select last_seen_at::text as at from auth_sessions`)[0]!.at as string;

    await database.sql`update auth_sessions set last_seen_at = now() - interval '2 hours'`;
    const recent = await seen();
    await auth.validateSession(token);
    expect(await seen()).toBe(recent);

    await database.sql`update auth_sessions set last_seen_at = now() - interval '2 days'`;
    const stale = await seen();
    await auth.validateSession(token);
    expect(await seen()).not.toBe(stale);
  });

  test("the list holds live sessions only, the most recently seen first", async () => {
    const [old, fresh, dead] = [await auth.createSession("old"), await auth.createSession("fresh"), await auth.createSession("dead")];
    await database.sql`update auth_sessions set last_seen_at = now() - interval '3 days' where id = ${sha256(old)}`;
    await database.sql`update auth_sessions set expires_at = now() - interval '1 day' where id = ${sha256(dead)}`;
    expect((await auth.listSessions()).map((s) => s.userAgent)).toEqual(["fresh", "old"]);
    expect(fresh).toBeTruthy();
  });
});

describe("the PIN", () => {
  test("only 6 to 10 digits are accepted, nothing else", async () => {
    for (const pin of ["", "12345", "12345678901", "12345a", "123 456", "123456\n", "١٢٣٤٥٦", "-123456"]) {
      await expect((async () => auth.setPin(pin))()).rejects.toBeInstanceOf(auth.AuthError);
    }
    expect(await auth.hasPin()).toBe(false);
    await auth.setPin("123456");
    await auth.setPin("1234567890");
    expect(await auth.hasPin()).toBe(true);
  });

  test("it is stored as an argon2id hash and replaced, not added to", async () => {
    await auth.setPin("246810");
    await auth.setPin("135790");
    const rows = await database.sql`select pin_hash from auth_pin`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pin_hash).toStartWith("$argon2id$");
    expect(rows[0]!.pin_hash).not.toContain("135790");
    expect(await auth.verifyPin("135790")).toBe(true);
    expect(await auth.verifyPin("246810")).toBe(false);
  });

  test("with no PIN set every guess fails", async () => {
    expect(await auth.verifyPin("123456")).toBe(false);
    expect(await auth.verifyPin("")).toBe(false);
  });
});

describe("passkey rows", () => {
  const add = (credentialId: string, rpId = "example.test", transports?: string[]) =>
    auth.addCredential({ credentialId, rpId, publicKey: "pk", counter: 1, deviceLabel: "Phone", transports });

  test("are scoped to the relying party: another origin's passkey is invisible and cannot be fetched or removed", async () => {
    await add("cred-a");
    await add("cred-b", "localhost");

    expect((await auth.listCredentials("example.test")).map((c) => c.credentialId)).toEqual(["cred-a"]);
    expect(await auth.hasCredentials("example.test")).toBe(true);
    expect(await auth.hasCredentials("other.test")).toBe(false);
    expect(await auth.findCredentialByCredentialId("cred-b", "example.test")).toBeNull();
    expect(await auth.findCredentialByCredentialId("cred-b", "localhost")).toMatchObject({ credentialId: "cred-b", rpId: "localhost" });

    const foreign = (await auth.findCredentialByCredentialId("cred-b", "localhost"))!;
    await add("cred-c");
    await auth.deleteCredential(foreign.id, "example.test");
    expect(await auth.hasCredentials("localhost")).toBe(true);
  });

  test("the last passkey of an origin cannot be removed, but one of two can", async () => {
    await add("cred-a");
    const [only] = await auth.listCredentials("example.test");
    await expect((async () => auth.deleteCredential(only!.id, "example.test"))()).rejects.toBeInstanceOf(auth.AuthError);
    expect(await auth.hasCredentials("example.test")).toBe(true);

    await add("cred-b");
    await auth.deleteCredential(only!.id, "example.test");
    expect((await auth.listCredentials("example.test")).map((c) => c.credentialId)).toEqual(["cred-b"]);
  });

  test("a passkey of another origin does not count as a spare for the last-passkey rule", async () => {
    await add("cred-a");
    await add("cred-b", "localhost");
    const [only] = await auth.listCredentials("example.test");
    await expect((async () => auth.deleteCredential(only!.id, "example.test"))()).rejects.toBeInstanceOf(auth.AuthError);
  });

  test("a use stores the new counter and the time, and transports round-trip", async () => {
    await add("cred-a", "example.test", ["internal", "hybrid"]);
    const [row] = await auth.listCredentials("example.test");
    expect(row).toMatchObject({ counter: 1, transports: ["internal", "hybrid"], lastUsedAt: null });
    await auth.touchCredential(row!.id, 7);
    expect(await auth.findCredentialByCredentialId("cred-a", "example.test")).toMatchObject({ counter: 7, lastUsedAt: expect.anything() });
  });
});

describe("the challenge", () => {
  test("is single use", () => {
    auth.storeChallenge("n1", "challenge-1");
    expect(auth.takeChallenge("n1")).toBe("challenge-1");
    expect(auth.takeChallenge("n1")).toBeNull();
    expect(auth.takeChallenge("never-stored")).toBeNull();
  });

  test("dies after a minute", () => {
    auth.storeChallenge("n2", "challenge-2");
    advance(59_000);
    auth.storeChallenge("n3", "challenge-3");
    expect(auth.takeChallenge("n3")).toBe("challenge-3");
    auth.storeChallenge("n4", "challenge-4");
    advance(61_000);
    expect(auth.takeChallenge("n2")).toBeNull();
  });
});

describe("the passkey-verified cookie", () => {
  test("names the credential that passed, and is refused for an unknown or missing nonce", () => {
    const nonce = auth.issuePkv("cred-1");
    expect(auth.checkPkv(nonce)).toEqual({ credentialId: "cred-1", attempts: 0 });
    expect(auth.checkPkv(undefined)).toBeNull();
    expect(auth.checkPkv("")).toBeNull();
    expect(auth.checkPkv("made-up")).toBeNull();
  });

  test("five wrong PINs kill it, four do not", () => {
    const nonce = auth.issuePkv("cred-1");
    for (let i = 0; i < 4; i++) auth.recordPkvAttempt(nonce);
    expect(auth.checkPkv(nonce)).not.toBeNull();
    auth.recordPkvAttempt(nonce);
    expect(auth.checkPkv(nonce)).toBeNull();
    auth.recordPkvAttempt("unknown");
  });

  test("is consumed on success and expires after five minutes", () => {
    const used = auth.issuePkv("cred-1");
    auth.consumePkv(used);
    expect(auth.checkPkv(used)).toBeNull();

    const aging = auth.issuePkv("cred-2");
    advance(5 * MINUTE - 1000);
    expect(auth.checkPkv(aging)).not.toBeNull();
    advance(5 * MINUTE + 1000);
    expect(auth.checkPkv(aging)).toBeNull();
  });
});

describe("the per-IP lockout", () => {
  test("ten failures lock the address for 15 minutes, nine do not, and others are unaffected", () => {
    for (let i = 0; i < 9; i++) auth.recordIpFailure("198.51.100.1");
    expect(auth.ipLocked("198.51.100.1")).toBe(false);
    auth.recordIpFailure("198.51.100.1");
    expect(auth.ipLocked("198.51.100.1")).toBe(true);
    expect(auth.ipLocked("198.51.100.2")).toBe(false);

    advance(15 * MINUTE - 1000);
    expect(auth.ipLocked("198.51.100.1")).toBe(true);
    advance(15 * MINUTE + 1000);
    expect(auth.ipLocked("198.51.100.1")).toBe(false);
  });

  test("each further lock doubles, and the failure count starts over after a lock", () => {
    const ip = "198.51.100.3";
    for (let i = 0; i < 10; i++) auth.recordIpFailure(ip);
    advance(16 * MINUTE);
    expect(auth.ipLocked(ip)).toBe(false);

    for (let i = 0; i < 9; i++) auth.recordIpFailure(ip);
    expect(auth.ipLocked(ip)).toBe(false);
    auth.recordIpFailure(ip);
    expect(auth.ipLocked(ip)).toBe(true);
    advance(16 * MINUTE + 29 * MINUTE);
    expect(auth.ipLocked(ip)).toBe(true);
    advance(16 * MINUTE + 31 * MINUTE);
    expect(auth.ipLocked(ip)).toBe(false);
  });

  test("a success clears the count", () => {
    const ip = "198.51.100.4";
    for (let i = 0; i < 9; i++) auth.recordIpFailure(ip);
    auth.clearIpFailures(ip);
    for (let i = 0; i < 9; i++) auth.recordIpFailure(ip);
    expect(auth.ipLocked(ip)).toBe(false);
  });
});

describe("authManagerDenied", () => {
  const denied = async (session: { id: string } | null, cookies: Record<string, string> = {}) => {
    const res = auth.authManagerDenied({ locals: { session }, cookies: fakeCookies(cookies) as any });
    return res ? { status: res.status, body: await res.json() } : null;
  };

  test("lets a logged-in session through and refuses everyone else with a 401", async () => {
    expect(await denied({ id: "s" })).toBeNull();
    expect(await denied(null)).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect((await denied(null, { pidra_bootstrap: "guess" }))?.status).toBe(401);
    expect((await denied(null, { [auth.SESSION_COOKIE]: "a-session-cookie-is-not-a-bootstrap" }))?.status).toBe(401);
  });

  test("the bootstrap cookie opens the door only while its nonce is live", async () => {
    const nonce = auth.issueBootstrap();
    expect(await denied(null, { [auth.BOOTSTRAP_COOKIE]: nonce })).toBeNull();
    advance(10 * MINUTE + 1000);
    expect((await denied(null, { [auth.BOOTSTRAP_COOKIE]: nonce }))?.status).toBe(401);
  });
});

describe("setAuthCookie", () => {
  test("is secure, lax and site-wide, httpOnly unless the page has to read it", () => {
    const jar = fakeCookies();
    auth.setAuthCookie(jar as any, auth.SESSION_COOKIE, "tok", 100);
    auth.setAuthCookie(jar as any, auth.SESSION_UI_COOKIE, "1", 100, false);
    expect(jar.sets).toEqual([
      { name: "pidra_session", value: "tok", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 100 } },
      { name: "pidra_ui", value: "1", options: { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 100 } },
    ]);
  });

  test("the relying party comes from the environment", () => {
    expect(auth.rpConfig()).toEqual({ rpID: "example.test", rpName: "PIDRA", origin: "https://example.test" });
  });
});
