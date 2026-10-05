// dashboard/src/hooks.server.ts: the auth gate that is all that stands between the internet and
// the briefing archive, and the headers every answer carries. Sessions are real rows; the page
// itself is a stub `resolve`.
import { beforeEach, describe, expect, test } from "bun:test";
import { makeEvent, setAppEnv, setPrivateEnv } from "./fixtures/dashboard";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
setPrivateEnv();
const { handle } = await import("../dashboard/src/hooks.server");
const { createSession, SESSION_COOKIE } = await import("../dashboard/src/lib/server/auth");

beforeEach(async () => {
  await database.sql`truncate auth_sessions cascade`;
  setAppEnv({ building: false });
});

interface Seen { resolved: number; options?: any; session?: unknown }
async function run(path: string, init: Parameters<typeof makeEvent>[0] = {}, response: () => Response = () => new Response("page", { headers: { "content-type": "text/html" } })) {
  const event = makeEvent({ method: "GET", path, ...init });
  const seen: Seen = { resolved: 0 };
  const res = await handle({
    event: event as any,
    resolve: async (_event: any, options: any) => {
      seen.resolved += 1;
      seen.options = options;
      seen.session = event.locals.session;
      return response();
    },
  });
  return { res, seen, event };
}

describe("who gets through", () => {
  test("a page request without a session is redirected to the login with the path to come back to", async () => {
    const { res, seen } = await run("/notes/my%20list");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?redirect=%2Fnotes%2Fmy%2520list");
    expect(seen.resolved).toBe(0);
  });

  test("an API request without a session is a 401 JSON, whatever the case of the prefix", async () => {
    for (const path of ["/api/notes", "/API/notes", "/Api/settings", "/api/offline/snapshot", "/api/auth"]) {
      const { res, seen } = await run(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(seen.resolved).toBe(0);
    }
  });

  test("only the listed pages and prefixes are public", async () => {
    const open = ["/login", "/setup", "/privacy", "/terms", "/manifest.webmanifest", "/service-worker.js", "/api/health", "/_app/immutable/a.js", "/icons/192.png", "/api/auth/pin/verify", "/api/auth/webauthn/challenge"];
    for (const path of open) expect((await run(path)).seen.resolved, path).toBe(1);

    const closed = ["/", "/2026-10-05", "/login/", "/loginx", "/setup/extra", "/api/healthz", "/api/health/deep", "/api/authx/pin", "/api/authorize", "/_app", "/_apps/x", "/icons", "/privacy/x", "/robots.txt", "/%6Cogin"];
    for (const path of closed) expect((await run(path)).seen.resolved, path).toBe(0);
  });

  test("a live session cookie passes and is handed to the page as locals.session", async () => {
    const token = await createSession("ua");
    const { res, seen } = await run("/notes", { cookies: { [SESSION_COOKIE]: token } });
    expect(res.status).toBe(200);
    expect(seen.resolved).toBe(1);
    expect(seen.session).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  test("a cookie that is wrong, expired or revoked is no session at all", async () => {
    const expired = await createSession(null);
    const revoked = await createSession(null);
    await database.sql`update auth_sessions set expires_at = now() - interval '1 minute' where id = (select id from auth_sessions order by created_at limit 1)`;
    await database.sql`delete from auth_sessions where id = (select id from auth_sessions order by created_at desc limit 1)`;
    for (const value of ["guess", expired, revoked, "", "undefined"]) {
      const { res, seen } = await run("/notes", { cookies: { [SESSION_COOKIE]: value } });
      expect(res.status, value).toBe(303);
      expect(seen.resolved).toBe(0);
    }
  });

  test("a public page ignores a bad cookie and still renders", async () => {
    const { res, seen } = await run("/login", { cookies: { [SESSION_COOKIE]: "stale" } });
    expect(res.status).toBe(200);
    expect(seen.session).toBeNull();
  });

  test("while prerendering nothing is gated and no session is looked up", async () => {
    const token = await createSession(null);
    setAppEnv({ building: true });
    const withCookie = await run("/notes", { cookies: { [SESSION_COOKIE]: token } });
    expect(withCookie.res.status).toBe(200);
    expect(withCookie.seen.session).toBeNull();
    const without = await run("/notes");
    expect(without.res.status).toBe(200);
    expect(without.seen.resolved).toBe(1);
  });
});

describe("what every answer carries", () => {
  const SECURITY = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=()",
  };

  test("the security headers and the pidra stamp are on a page, a redirect and a 401 alike", async () => {
    const token = await createSession(null);
    const answers = [
      (await run("/notes", { cookies: { [SESSION_COOKIE]: token } })).res,
      (await run("/notes")).res,
      (await run("/api/notes")).res,
    ];
    for (const res of answers) {
      expect(res.headers.get("x-pidra")).toBe("1");
      for (const [name, value] of Object.entries(SECURITY)) expect(res.headers.get(name), name).toBe(value);
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
      expect(res.headers.get("content-security-policy-report-only")).toContain("default-src 'self'");
    }
  });

  test("a response with immutable headers (as a proxied fetch gives) is stamped on a copy", async () => {
    const frozen = () => {
      const response = new Response("body", { status: 201, headers: { "content-type": "text/html", "x-upstream": "kept" } });
      const headers = new Headers(response.headers);
      headers.set = headers.append = () => { throw new TypeError("immutable"); };
      Object.defineProperty(response, "headers", { value: headers });
      return response;
    };
    const { res } = await run("/login", {}, frozen);
    expect([res.status, await res.text(), res.headers.get("x-upstream")]).toEqual([201, "body", "kept"]);
    expect(res.headers.get("x-pidra")).toBe("1");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("only x-pidra survives into the replayed server load", async () => {
    const { seen } = await run("/login");
    expect(["x-pidra", "set-cookie", "authorization"].filter((name) => seen.options.filterSerializedResponseHeaders(name))).toEqual(["x-pidra"]);
  });

  test("the shell marker is set on the HTML of a mirrored route only, never on a data request or a non-HTML answer", async () => {
    const token = await createSession(null);
    const cookies = { [SESSION_COOKIE]: token };
    const shell = async (init: Parameters<typeof makeEvent>[0], response?: () => Response) =>
      (await run(init.path ?? "/", { cookies, ...init }, response)).res.headers.get("x-pidra-shell");

    expect(await shell({ path: "/notes" })).toBe("1");
    expect(await shell({ path: "/notes" }, () => new Response("{}", { headers: { "content-type": "application/json" } }))).toBeNull();
    expect(await shell({ path: "/questions" })).toBeNull();

    const data = makeEvent({ method: "GET", path: "/notes", cookies });
    data.isDataRequest = true;
    const res = await handle({ event: data as any, resolve: async () => new Response("x", { headers: { "content-type": "text/html" } }) } as any);
    expect(res.headers.get("x-pidra-shell")).toBeNull();
  });
});
