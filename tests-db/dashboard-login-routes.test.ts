// The login flow's endpoints and pages (passkey, then PIN, then a session; the /setup bootstrap):
// handlers called directly with a RequestEvent-shaped object, auth tables real. Only the WebAuthn
// signature check is stubbed; every state decision around it is the dashboard's own.
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { makeEvent, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const verifier = {
  authenticate: async (_args: any): Promise<any> => ({ verified: true, authenticationInfo: { newCounter: 9 } }),
  register: async (_args: any): Promise<any> => ({ verified: true, registrationInfo: { credential: { id: "new-cred", publicKey: new Uint8Array([1, 2, 3, 250]), counter: 0, transports: ["internal"] } } }),
};
const verifyCalls: { kind: string; args: any }[] = [];
const webauthnPath = Bun.resolveSync("@simplewebauthn/server", `${import.meta.dir}/../dashboard`);
const real = await import(webauthnPath);
mock.module(webauthnPath, () => ({
  ...real,
  verifyAuthenticationResponse: async (args: any) => { verifyCalls.push({ kind: "authenticate", args }); return verifier.authenticate(args); },
  verifyRegistrationResponse: async (args: any) => { verifyCalls.push({ kind: "register", args }); return verifier.register(args); },
}));

const database = await useTestDatabase();
setPrivateEnv();
const auth = await import("../dashboard/src/lib/server/auth");
const route = async (name: string) => (await import(`../dashboard/src/routes/api/auth/${name}/+server`)).POST;
const pinVerify = await route("pin/verify");
const pinSet = await route("pin/set");
const logout = await route("logout");
const webauthnChallenge = await route("webauthn/challenge");
const webauthnVerify = await route("webauthn/verify");
const registerChallenge = await route("register/challenge");
const registerVerify = await route("register/verify");
const login = await import("../dashboard/src/routes/login/+page.server");
const setup = await import("../dashboard/src/routes/setup/+page.server");

// Argon2 costs about 100 ms a call and these tests make dozens; dashboard-auth.test.ts covers the real hash.
spyOn(Bun.password, "hash").mockImplementation(async (pin: any) => `argon2id-stub:${pin}`);
spyOn(Bun.password, "verify").mockImplementation(async (pin: any, hash: any) => hash === `argon2id-stub:${pin}`);

let ipCounter = 0;
const freshIp = () => `198.51.100.${++ipCounter}`;
const sessionCount = async () => (await database.sql`select count(*)::int as n from auth_sessions`)[0]!.n as number;
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const thrown = async (fn: () => unknown) => { try { await fn(); } catch (err) { return err as any; } return null; };
const addCredential = (credentialId = "cred-a", rpId = "example.test") => auth.addCredential({ credentialId, rpId, publicKey: "cHVibGlj", counter: 3, deviceLabel: "Phone" });

beforeEach(async () => {
  verifyCalls.length = 0;
  verifier.authenticate = async () => ({ verified: true, authenticationInfo: { newCounter: 9 } });
  await database.sql`truncate auth_sessions, auth_credentials, auth_pin cascade`;
  setPrivateEnv({ AUTH_SETUP_TOKEN: "setup-token-for-tests" });
});

describe("POST /api/auth/pin/verify", () => {
  const attempt = (pin: unknown, nonce: string | undefined, ip: string, extra: Parameters<typeof makeEvent>[0] = {}) =>
    pinVerify(makeEvent({ json: pin === undefined ? undefined : { pin }, cookies: nonce ? { [auth.PKV_COOKIE]: nonce } : {}, ip, ...extra }));

  test("is refused without a live passkey step, and nothing is created", async () => {
    await auth.setPin("123456");
    for (const nonce of [undefined, "made-up"]) {
      expect(await json(await attempt("123456", nonce, freshIp()))).toEqual({ status: 401, body: { error: "Passkey step expired. Start over." } });
    }
    expect(await sessionCount()).toBe(0);
  });

  test("the right PIN after the passkey opens a session: hashed row, httpOnly cookie, readable UI cookie, nonce spent", async () => {
    await auth.setPin("123456");
    const nonce = auth.issuePkv("cred-1");
    const event = makeEvent({ json: { pin: "123456" }, cookies: { [auth.PKV_COOKIE]: nonce }, ip: freshIp(), headers: { "user-agent": "TestBrowser/1" } });
    expect(await json(await pinVerify(event))).toEqual({ status: 200, body: { ok: true } });

    const month = 60 * 60 * 24 * 30;
    const [session, ui] = event.cookies.sets;
    expect(session).toMatchObject({ name: auth.SESSION_COOKIE, options: { httpOnly: true, secure: true, sameSite: "lax", maxAge: month } });
    expect(ui).toMatchObject({ name: auth.SESSION_UI_COOKIE, value: "1", options: { httpOnly: false, secure: true, maxAge: month } });
    expect(event.cookies.deletes).toEqual([auth.PKV_COOKIE]);
    expect(await auth.validateSession(session!.value)).not.toBeNull();
    expect((await database.sql`select user_agent from auth_sessions`)[0]!.user_agent).toBe("TestBrowser/1");

    expect((await attempt("123456", nonce, freshIp())).status).toBe(401);
    expect(await sessionCount()).toBe(1);
  });

  test("a wrong or missing PIN is a 401 that makes no session", async () => {
    await auth.setPin("123456");
    const nonce = auth.issuePkv("cred-1");
    for (const pin of ["654321", "", undefined, null, 12345, {}, "123456 "]) {
      expect(await json(await attempt(pin, auth.issuePkv("cred-1"), freshIp()))).toEqual({ status: 401, body: { error: "Incorrect PIN." } });
    }
    const garbled = await pinVerify(makeEvent({ body: "{oops", cookies: { [auth.PKV_COOKIE]: nonce }, ip: freshIp() }));
    expect(garbled.status).toBe(401);
    expect(await sessionCount()).toBe(0);
  });

  test("five wrong PINs burn the passkey step, so even the right PIN then fails", async () => {
    await auth.setPin("123456");
    const nonce = auth.issuePkv("cred-1");
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await attempt("000000", nonce, ip)).status).toBe(401);
    expect(await json(await attempt("123456", nonce, ip))).toEqual({ status: 401, body: { error: "Passkey step expired. Start over." } });
    expect(await sessionCount()).toBe(0);
  });

  test("ten failures from one address lock it out for everything, the right PIN included; other addresses are unaffected", async () => {
    await auth.setPin("123456");
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await attempt("000000", auth.issuePkv("cred-1"), ip);

    expect(await json(await attempt("123456", auth.issuePkv("cred-1"), ip))).toEqual({ status: 429, body: { error: "Too many attempts. Try again later." } });
    expect((await webauthnChallenge(makeEvent({ ip }))).status).toBe(429);
    expect((await webauthnVerify(makeEvent({ ip, json: { nonce: "n", response: { id: "x" } } }))).status).toBe(429);
    expect((await attempt("123456", auth.issuePkv("cred-1"), freshIp())).status).toBe(200);
  });

  test("a successful login wipes the address's failure count", async () => {
    await auth.setPin("123456");
    const ip = freshIp();
    for (let i = 0; i < 9; i++) await attempt("000000", auth.issuePkv("cred-1"), ip);
    expect((await attempt("123456", auth.issuePkv("cred-1"), ip)).status).toBe(200);
    for (let i = 0; i < 9; i++) await attempt("000000", auth.issuePkv("cred-1"), ip);
    expect(auth.ipLocked(ip)).toBe(false);
  });
});

describe("the passkey step", () => {
  const assertion = (id = "cred-a") => ({ id, rawId: id, type: "public-key", response: {} });
  const challenge = (value = "the-challenge") => { auth.storeChallenge("nonce-1", value); return "nonce-1"; };
  const verify = (body: unknown, ip = freshIp()) => webauthnVerify(makeEvent({ json: body, ip }));

  test("challenge hands out options for this relying party and keeps the challenge for one use", async () => {
    const { options, nonce } = (await (await webauthnChallenge(makeEvent({ ip: freshIp() }))).json()) as any;
    expect(options.rpId).toBe("example.test");
    expect(auth.takeChallenge(nonce)).toBe(options.challenge);
    expect(auth.takeChallenge(nonce)).toBeNull();
  });

  test("a good assertion stores the new counter and starts the PIN step, bound to that credential, with no session yet", async () => {
    await addCredential();
    const ip = freshIp();
    for (let i = 0; i < 5; i++) auth.recordIpFailure(ip);
    const event = makeEvent({ ip, json: { nonce: challenge("expected-challenge"), response: assertion() } });
    expect(await json(await webauthnVerify(event))).toEqual({ status: 200, body: { ok: true } });

    const stored = (await auth.findCredentialByCredentialId("cred-a", "example.test"))!;
    expect(stored.counter).toBe(9);
    const [pkv] = event.cookies.sets;
    expect(pkv).toMatchObject({ name: auth.PKV_COOKIE, options: { httpOnly: true, secure: true, maxAge: 300 } });
    expect(auth.checkPkv(pkv!.value)).toEqual({ credentialId: stored.id, attempts: 0 });
    expect(event.cookies.sets.map((c) => c.name)).toEqual([auth.PKV_COOKIE]);
    expect(await sessionCount()).toBe(0);
    for (let i = 0; i < 5; i++) auth.recordIpFailure(ip);
    expect(auth.ipLocked(ip)).toBe(false);
  });

  test("the verifier is given the stored challenge, this origin and relying party, and the stored key and counter", async () => {
    await addCredential();
    await verify({ nonce: challenge("expected-challenge"), response: assertion() });
    const [{ args }] = verifyCalls;
    expect(args).toMatchObject({ expectedChallenge: "expected-challenge", expectedOrigin: "https://example.test", expectedRPID: "example.test" });
    expect(args.credential).toMatchObject({ id: "cred-a", counter: 3 });
    expect(Buffer.from(args.credential.publicKey).toString("base64url")).toBe("cHVibGlj");
  });

  test("a missing, spent or expired challenge is a 400 and a challenge is used up by its first attempt", async () => {
    await addCredential();
    for (const body of [{}, { response: assertion() }, { nonce: "never-issued", response: assertion() }, { nonce: challenge() }]) {
      expect((await verify(body)).status).toBe(400);
    }
    verifier.authenticate = async () => ({ verified: false });
    expect((await verify({ nonce: challenge(), response: assertion() })).status).toBe(401);
    expect((await verify({ nonce: "nonce-1", response: assertion() })).status).toBe(400);
  });

  test("an unknown credential, one of another relying party, a failed check and a throwing check are all 401s that count against the address", async () => {
    await addCredential("cred-a");
    await addCredential("cred-other", "localhost");
    const ip = freshIp();
    const attempts: [string, () => void][] = [
      ["cred-unknown", () => {}],
      ["cred-other", () => {}],
      ["cred-a", () => { verifier.authenticate = async () => ({ verified: false }); }],
      ["cred-a", () => { verifier.authenticate = async () => { throw new Error("bad signature"); }; }],
    ];
    for (const [id, arrange] of attempts) {
      arrange();
      const res = await verify({ nonce: challenge(), response: assertion(id) }, ip);
      expect(res.status, id).toBe(401);
    }
    expect((await auth.findCredentialByCredentialId("cred-a", "example.test"))!.counter).toBe(3);
    for (let i = 0; i < 6; i++) auth.recordIpFailure(ip);
    expect(auth.ipLocked(ip)).toBe(true);
    expect(verifyCalls).toHaveLength(2);
  });
});

describe("managing passkeys and the PIN", () => {
  const event = (init: Parameters<typeof makeEvent>[0] = {}) => makeEvent({ ...init, ip: freshIp() });

  test("register and pin/set refuse an anonymous caller and change nothing", async () => {
    expect((await registerChallenge(event())).status).toBe(401);
    expect((await registerVerify(event({ json: { nonce: challenge(), response: {} } }))).status).toBe(401);
    expect((await pinSet(event({ json: { pin: "123456" } }))).status).toBe(401);
    expect(await auth.hasPin()).toBe(false);
    expect(await auth.hasCredentials("example.test")).toBe(false);
    expect(verifyCalls).toEqual([]);

    function challenge() { auth.storeChallenge("reg-nonce", "c"); return "reg-nonce"; }
  });

  test("a session or the live bootstrap cookie may set the PIN; a bad PIN is a 400 with the reason", async () => {
    const bootstrap = { [auth.BOOTSTRAP_COOKIE]: auth.issueBootstrap() };
    expect(await json(await pinSet(event({ json: { pin: "12ab" }, cookies: bootstrap })))).toEqual({ status: 400, body: { error: "PIN must be 6-10 digits." } });
    expect(await auth.hasPin()).toBe(false);
    expect((await pinSet(event({ json: { pin: "123456" }, cookies: bootstrap }))).status).toBe(200);
    expect((await pinSet(event({ json: { pin: "654321" }, session: { id: "s" } }))).status).toBe(200);
    expect(await auth.verifyPin("654321")).toBe(true);
    expect((await pinSet(event({ json: {}, session: { id: "s" } }))).status).toBe(400);
  });

  test("registration challenge excludes the passkeys already stored and keeps its challenge for one use", async () => {
    await addCredential("cred-a");
    const { options, nonce } = (await (await registerChallenge(event({ session: { id: "s" } }))).json()) as any;
    expect(options.excludeCredentials.map((c: any) => c.id)).toEqual(["cred-a"]);
    expect(auth.takeChallenge(nonce)).toBe(options.challenge);
  });

  test("registration verify stores the passkey for this relying party with a label cut to 80 characters", async () => {
    auth.storeChallenge("reg-1", "reg-challenge");
    const res = await registerVerify(event({ session: { id: "s" }, json: { nonce: "reg-1", response: { id: "x" }, deviceLabel: "L".repeat(120) } }));
    expect(res.status).toBe(200);
    expect(verifyCalls[0]!.args).toMatchObject({ expectedChallenge: "reg-challenge", expectedOrigin: "https://example.test", expectedRPID: "example.test" });
    const [row] = await auth.listCredentials("example.test");
    expect(row).toMatchObject({ credentialId: "new-cred", publicKey: Buffer.from([1, 2, 3, 250]).toString("base64url"), counter: 0, transports: ["internal"], rpId: "example.test" });
    expect(row!.deviceLabel).toBe("L".repeat(80));
  });

  test("a failed registration or an expired challenge stores nothing", async () => {
    expect(await json(await registerVerify(event({ session: { id: "s" }, json: { nonce: "gone", response: { id: "x" } } })))).toEqual({ status: 400, body: { error: "Challenge expired. Try again." } });
    auth.storeChallenge("reg-2", "c");
    verifier.register = async () => ({ verified: false });
    expect(await json(await registerVerify(event({ session: { id: "s" }, json: { nonce: "reg-2", response: { id: "x" } } })))).toEqual({ status: 400, body: { error: "Registration failed." } });
    expect(await auth.hasCredentials("example.test")).toBe(false);
  });
});

describe("POST /api/auth/logout", () => {
  test("revokes this session only and clears both cookies, also when there is nothing to revoke", async () => {
    const mine = await auth.createSession(null);
    const other = await auth.createSession(null);
    const event = makeEvent({ cookies: { [auth.SESSION_COOKIE]: mine } });
    expect(await json(await logout(event))).toEqual({ status: 200, body: { ok: true } });
    expect(event.cookies.deletes.sort()).toEqual([auth.SESSION_COOKIE, auth.SESSION_UI_COOKIE].sort());
    expect(await auth.validateSession(mine)).toBeNull();
    expect(await auth.validateSession(other)).not.toBeNull();

    const bare = makeEvent();
    expect((await logout(bare)).status).toBe(200);
    expect(bare.cookies.deletes).toHaveLength(2);
  });
});

describe("the /login and /setup pages", () => {
  const url = (token?: string) => `/setup${token === undefined ? "" : `?token=${encodeURIComponent(token)}`}`;
  const load = (token: string | undefined, init: Parameters<typeof makeEvent>[0] = {}) => {
    const event = makeEvent({ method: "GET", path: url(token), ...init });
    return { event, result: thrown(() => setup.load(event as any)) };
  };

  test("login sends a fresh install to /setup and lets a set-up one see the form; another origin's passkey does not count", async () => {
    const redirected = await thrown(() => login.load({} as any));
    expect([redirected.status, redirected.location]).toEqual([303, "/setup"]);
    await addCredential("cred-other", "localhost");
    expect((await thrown(() => login.load({} as any)))?.location).toBe("/setup");
    await addCredential();
    expect(await login.load({} as any)).toBeUndefined();
  });

  test("the setup token is the only way in before any passkey exists: a wrong, missing or unset token is a 404 and sets no cookie", async () => {
    for (const token of [undefined, "", "wrong", "setup-token-for-tests "]) {
      const { event, result } = load(token);
      expect((await result).status, String(token)).toBe(404);
      expect(event.cookies.sets).toEqual([]);
    }
    for (const configured of [undefined, ""]) {
      setPrivateEnv({ AUTH_SETUP_TOKEN: configured });
      for (const token of [undefined, "", "undefined"]) expect((await load(token).result).status, `${configured} / ${token}`).toBe(404);
    }
  });

  test("the right token opens a ten-minute bootstrap window that lets the management endpoints through", async () => {
    const event = makeEvent({ method: "GET", path: url("setup-token-for-tests") });
    const data = (await setup.load(event as any)) as any;
    expect(data).toMatchObject({ credentials: [], pinSet: false, sessions: [], bootstrapping: true });
    const [cookie] = event.cookies.sets;
    expect(cookie).toMatchObject({ name: auth.BOOTSTRAP_COOKIE, options: { httpOnly: true, secure: true, maxAge: 600 } });
    expect(auth.authManagerDenied({ locals: { session: null }, cookies: event.cookies as any })).toBeNull();
  });

  test("once a passkey exists the token is dead and a visitor without a session goes to the login", async () => {
    await addCredential();
    const { event, result } = load("setup-token-for-tests");
    const redirected = await result;
    expect([redirected.status, redirected.location]).toEqual([303, "/login?redirect=%2Fsetup"]);
    expect(event.cookies.sets).toEqual([]);
  });

  test("a logged-in owner sees credentials, PIN state and sessions, without a bootstrap cookie", async () => {
    await addCredential();
    await auth.setPin("123456");
    await auth.createSession("ua");
    const event = makeEvent({ method: "GET", path: "/setup", session: { id: "s" } });
    const data = (await setup.load(event as any)) as any;
    expect(data).toMatchObject({ pinSet: true, bootstrapping: false });
    expect(data.credentials).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(event.cookies.sets).toEqual([]);
  });

  test("the actions need a session; removing the last passkey is a 400 and revoking signs a session out", async () => {
    const act = (name: "deleteCredential" | "revokeSession", id: string, session: { id: string } | null) => {
      const form = new FormData();
      form.set("id", id);
      return (setup.actions as any)[name](makeEvent({ body: form, session }));
    };
    expect((await act("deleteCredential", "x", null)).status).toBe(401);
    expect((await act("revokeSession", "x", null)).status).toBe(401);

    await addCredential();
    const [only] = await auth.listCredentials("example.test");
    expect((await act("deleteCredential", only!.id, { id: "s" })).status).toBe(400);

    const token = await auth.createSession(null);
    const session = (await auth.listSessions())[0]!;
    expect(await act("revokeSession", session.id, { id: "s" })).toMatchObject({ ok: true });
    expect(await auth.validateSession(token)).toBeNull();
  });
});
