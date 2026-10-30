import { afterEach, describe, expect, test } from "bun:test";
import { parseAuthResponse, exchangeToken, AUTH_URL } from "../context-builder/sources/keep-google-auth";
import { syncKeepNotes, KeepApiError } from "../context-builder/sources/keep-api";
import { fetchKeepNotes } from "../context-builder/sources/keep";

const TS = { updated: "2024-01-02T03:04:05.123Z" };
const CREDS = { email: "user@example.com", masterToken: "aas_et/fake" };

interface Call { url: string; init: RequestInit }

/** Routes the auth endpoint to `auth` and the Keep API to successive `pages`; records every call. */
function fakeGoogle(opts: { auth?: () => string; pages: unknown[] }) {
  const calls: Call[] = [];
  let page = 0;
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (url === AUTH_URL) return new Response(opts.auth?.() ?? "Auth=tok-1\nissueAdvice=auto\n");
    return Response.json(opts.pages[Math.min(page++, opts.pages.length - 1)]);
  };
  return { fetcher, calls, apiCalls: () => calls.filter((c) => c.url !== AUTH_URL) };
}

const noSleep = async () => {};

describe("auth endpoint", () => {
  test("parseAuthResponse keeps '=' inside values", () => {
    expect(parseAuthResponse("Token=aas_et/abc==\nError=\n\nEmail=a@b.c")).toEqual({ Token: "aas_et/abc==", Error: "", Email: "a@b.c" });
  });

  test("a token request carries the Android client identity as a form body", async () => {
    const g = fakeGoogle({ auth: () => "Token=aas_et/x\n", pages: [] });
    const res = await exchangeToken("user@example.com", "oauth2_4/cookie", "aabbcc", g.fetcher);
    expect(res.Token).toBe("aas_et/x");
    const { init } = g.calls[0]!;
    const body = new URLSearchParams(String(init.body));
    expect(body.get("Token")).toBe("oauth2_4/cookie");
    expect(body.get("service")).toBe("ac2dm");
    expect(body.get("ACCESS_TOKEN")).toBe("1");
    expect(body.get("androidId")).toBe("aabbcc");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("GoogleAuth/1.4");
  });
});

describe("syncKeepNotes", () => {
  test("pages through truncated responses, sending targetVersion and the OAuth token", async () => {
    const g = fakeGoogle({
      pages: [
        { toVersion: "v1", truncated: true, userInfo: { labels: [{ mainId: "t1", name: "Ideas" }] }, nodes: [{ id: "n1", type: "NOTE", parentId: "root", timestamps: TS, labelIds: [{ labelId: "t1" }] }] },
        { toVersion: "v2", truncated: false, nodes: [{ id: "i1", type: "LIST_ITEM", parentId: "n1", timestamps: TS, text: "body" }] },
      ],
    });
    const notes = await syncKeepNotes(CREDS, { fetch: g.fetcher, sleep: noSleep });
    expect(notes).toMatchObject([{ id: "n1", text: "body", labels: ["Ideas"] }]);

    const [first, second] = g.apiCalls().map((c) => JSON.parse(String(c.init.body)));
    expect(first).not.toHaveProperty("targetVersion");
    expect(second.targetVersion).toBe("v1");
    expect(first.requestHeader.clientPlatform).toBe("ANDROID");
    expect((g.apiCalls()[0]!.init.headers as Record<string, string>).Authorization).toBe("OAuth tok-1");
  });

  test("a 401 fetches a fresh token and retries, at most twice", async () => {
    let n = 0;
    const g = fakeGoogle({ auth: () => `Auth=tok-${++n}\n`, pages: [{ error: { code: 401 } }, { toVersion: "v1", nodes: [] }] });
    expect(await syncKeepNotes(CREDS, { fetch: g.fetcher, sleep: noSleep })).toEqual([]);
    expect((g.apiCalls()[1]!.init.headers as Record<string, string>).Authorization).toBe("OAuth tok-2");

    const stuck = fakeGoogle({ pages: [{ error: { code: 401 } }] });
    await expect(syncKeepNotes(CREDS, { fetch: stuck.fetcher, sleep: noSleep })).rejects.toBeInstanceOf(KeepApiError);
    expect(stuck.apiCalls()).toHaveLength(3);
  });

  test("a 429 backs off with doubling waits, then continues", async () => {
    const waits: number[] = [];
    const g = fakeGoogle({ pages: [{ error: { code: 429 } }, { error: { code: 429 } }, { toVersion: "v1" }] });
    await syncKeepNotes(CREDS, { fetch: g.fetcher, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000, 4000]);
  });

  test("other API errors and full-resync demands throw", async () => {
    const forbidden = fakeGoogle({ pages: [{ error: { code: 403 } }] });
    await expect(syncKeepNotes(CREDS, { fetch: forbidden.fetcher, sleep: noSleep })).rejects.toThrow("403");
    const resync = fakeGoogle({ pages: [{ toVersion: "v1", forceFullResync: true }] });
    await expect(syncKeepNotes(CREDS, { fetch: resync.fetcher, sleep: noSleep })).rejects.toThrow("resync");
  });

  test("a rejected login surfaces Google's error, not a token", async () => {
    const g = fakeGoogle({ auth: () => "Error=BadAuthentication\n", pages: [] });
    await expect(syncKeepNotes(CREDS, { fetch: g.fetcher, sleep: noSleep })).rejects.toThrow("BadAuthentication");
  });
});

describe("fetchKeepNotes", () => {
  const saved = { email: process.env.GKEEPAPI_EMAIL, token: process.env.GKEEPAPI_MASTER_TOKEN };
  afterEach(() => {
    for (const [k, v] of [["GKEEPAPI_EMAIL", saved.email], ["GKEEPAPI_MASTER_TOKEN", saved.token]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("withholds Credentials-labelled notes at the single exit, case-insensitively", async () => {
    process.env.GKEEPAPI_EMAIL = CREDS.email;
    process.env.GKEEPAPI_MASTER_TOKEN = CREDS.masterToken;
    const g = fakeGoogle({
      pages: [{
        toVersion: "v1",
        userInfo: { labels: [{ mainId: "t1", name: "credentials" }, { mainId: "t2", name: "Ideas" }] },
        nodes: [
          { id: "secret", type: "NOTE", parentId: "root", timestamps: TS, text: "pin 1234", labelIds: [{ labelId: "t1" }] },
          { id: "fine", type: "NOTE", parentId: "root", timestamps: TS, text: "ok", labelIds: [{ labelId: "t2" }] },
        ],
      }],
    });
    const notes = await fetchKeepNotes({ fetch: g.fetcher, sleep: noSleep });
    expect(notes.map((n) => n.id)).toEqual(["fine"]);
  });
});
