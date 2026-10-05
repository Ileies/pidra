// Protects the Brave client's budget rule (CLAUDE.md): every actual request, a retry included,
// first reserves one of 30 calls for the UTC day, and a spent quota or a failed reservation fails
// closed - no request is sent and nothing is retried. The db is a counter that behaves the way the
// upsert is written to (it reads the limit and the operator out of the query it is handed); fetch and
// Bun.sleep are spies, so nothing waits and nothing leaves the machine.
import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import { dbModule } from "./fixtures/db";
import { utcDay } from "../src/util/time";

type Insert = { values: { day: string; calls: number }; setWhere: { sql: string; params: unknown[] } };

const dialect = new PgDialect();
let usage = new Map<string, number>();
let inserts: Insert[] = [];
let dbFailure: Error | null = null;

const db = {
  insert: (table: unknown) => {
    expect(table).toBe(schema.braveDailyUsage);
    return {
      values: (values: Insert["values"]) => ({
        onConflictDoUpdate: (cfg: { setWhere: Parameters<PgDialect["sqlToQuery"]>[0] }) => ({
          returning: async () => {
            const setWhere = dialect.sqlToQuery(cfg.setWhere);
            inserts.push({ values, setWhere });
            if (dbFailure) throw dbFailure;
            const so_far = usage.get(values.day);
            if (so_far === undefined) {
              usage.set(values.day, 1);
              return [{ calls: 1 }];
            }
            const limit = Number(setWhere.params[0]);
            if (!/calls" < \$1$/.test(setWhere.sql) || so_far >= limit) return [];
            usage.set(values.day, so_far + 1);
            return [{ calls: so_far + 1 }];
          },
        }),
      }),
    };
  },
};

mock.module("../src/db", () => dbModule(db));
process.env.BRAVE_SEARCH_API_KEY = "test-key";
const { braveSearch, braveContext } = await import("../src/search/brave?brave-test");

type FetchCall = { url: URL; headers: Record<string, string> };
let fetched: FetchCall[] = [];
let responses: (() => Response)[] = [];
let sleeps: number[] = [];
let fetchSpy: ReturnType<typeof spyOn>;
let sleepSpy: ReturnType<typeof spyOn>;

const json = (body: unknown, init?: ResponseInit) => () => new Response(JSON.stringify(body), init);
const webHit = { web: { results: [{ title: "T", url: "https://example.com/a", description: "D", age: "2 hours ago", page_age: "2026-10-05T01:00:00" }] } };

beforeEach(() => {
  usage = new Map();
  inserts = [];
  dbFailure = null;
  fetched = [];
  responses = [];
  sleeps = [];
  setSystemTime(new Date("2026-10-05T12:00:00Z"));
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
    fetched.push({ url: new URL(String(url)), headers: (init?.headers ?? {}) as Record<string, string> });
    return (responses.shift() ?? json(webHit))();
  }) as typeof fetch);
  sleepSpy = spyOn(Bun, "sleep").mockImplementation((async (ms: number) => {
    sleeps.push(Number(ms));
  }) as typeof Bun.sleep);
});

afterEach(() => {
  setSystemTime();
  fetchSpy.mockRestore();
  sleepSpy.mockRestore();
});

test("a search reserves one call for today, sends one request with the key, and maps the results", async () => {
  const out = await braveSearch("budget vote", 3);

  expect(inserts).toHaveLength(1);
  expect(inserts[0].values).toEqual({ day: "2026-10-05", calls: 1 });
  expect(fetched).toHaveLength(1);
  expect(fetched[0].url.pathname).toBe("/res/v1/web/search");
  expect(fetched[0].url.searchParams.get("q")).toBe("budget vote");
  expect(fetched[0].url.searchParams.get("count")).toBe("3");
  expect(fetched[0].url.searchParams.get("freshness")).toBe("pd");
  expect(fetched[0].headers["X-Subscription-Token"]).toBe("test-key");
  expect(out.results).toEqual([{ title: "T", url: "https://example.com/a", description: "D", age: "2 hours ago", publishedAt: "2026-10-05T01:00:00", extraSnippets: undefined }]);
});

test("the cap is 30 calls per day, enforced by a strict less-than in the upsert", async () => {
  await braveSearch("q");
  expect(inserts[0].setWhere.sql).toMatch(/calls" < \$1$/);
  expect(inserts[0].setWhere.params).toEqual([30]);
});

test("freshness 'any' drops the filter, news uses the news endpoint, and the quota is shared by braveContext", async () => {
  await braveSearch("q", 5, { freshness: "any" });
  responses.push(json({ results: [{ title: "N", url: "https://example.com/n" }] }));
  const news = await braveSearch("q", 5, { kind: "news" });
  responses.push(json({ grounding: { generic: [{ title: "G", url: "https://example.com/g", snippets: ["s"] }] }, sources: {} }));
  const ctx = await braveContext("q");

  expect(fetched[0].url.searchParams.has("freshness")).toBe(false);
  expect(fetched[1].url.pathname).toBe("/res/v1/news/search");
  expect(news.results[0].title).toBe("N");
  expect(fetched[2].url.pathname).toBe("/res/v1/llm/context");
  expect(ctx.results[0]).toMatchObject({ title: "G", extraSnippets: ["s"] });
  expect(usage.get("2026-10-05")).toBe(3);
});

test("the 31st call of the day fails closed: no request is sent and nothing is retried", async () => {
  for (let i = 0; i < 30; i++) await braveSearch(`q${i}`);
  expect(fetched).toHaveLength(30);
  inserts = [];

  await expect(braveSearch("one too many")).rejects.toThrow("Brave Search daily limit of 30 requests reached");

  expect(fetched).toHaveLength(30);
  expect(inserts).toHaveLength(1);
  expect(usage.get("2026-10-05")).toBe(30);
});

test("the quota is per UTC day: it resets at 00:00 UTC and not before", async () => {
  setSystemTime(new Date("2026-10-04T23:59:59Z"));
  for (let i = 0; i < 30; i++) await braveSearch(`q${i}`);
  await expect(braveSearch("late")).rejects.toThrow("daily limit");

  setSystemTime(new Date("2026-10-05T00:00:01Z"));
  await braveSearch("next day");

  expect(inserts.at(-1)!.values.day).toBe(utcDay());
  expect(inserts.at(-1)!.values.day).toBe("2026-10-05");
  expect(usage.get("2026-10-05")).toBe(1);
  expect(usage.get("2026-10-04")).toBe(30);
});

test("every retry reserves its own call, and the third failure is final", async () => {
  responses.push(json({}, { status: 500 }), json({}, { status: 503 }), json({}, { status: 500 }));

  await expect(braveSearch("q")).rejects.toThrow("Brave Search error 500");

  expect(fetched).toHaveLength(3);
  expect(inserts).toHaveLength(3);
  expect(usage.get("2026-10-05")).toBe(3);
});

test("a retry that finds the quota spent stops there instead of sending a request", async () => {
  usage.set("2026-10-05", 29);
  responses.push(json({}, { status: 500 }));

  await expect(braveSearch("q")).rejects.toThrow("daily limit");

  expect(fetched).toHaveLength(1);
  expect(inserts).toHaveLength(2);
});

test("a 429 waits as long as the rate-limit header asks (capped at 10 s) before retrying", async () => {
  responses.push(() => new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": "3, 60" } }), json(webHit));
  await braveSearch("q");
  expect(sleeps).toContain(3000);
  expect(fetched).toHaveLength(2);

  sleeps = [];
  responses.push(() => new Response("slow down", { status: 429, headers: { "x-ratelimit-reset": "600" } }), json(webHit));
  await braveSearch("q");
  expect(sleeps).toContain(10_000);
});

test("a client error is not retried and still costs exactly the one call it used", async () => {
  responses.push(json({ error: "bad query" }, { status: 422 }));

  await expect(braveSearch("q")).rejects.toThrow("Brave Search error 422");

  expect(fetched).toHaveLength(1);
  expect(usage.get("2026-10-05")).toBe(1);
});

test("a failed reservation (database down) is final: no request, no retry", async () => {
  dbFailure = new Error("connection refused");

  await expect(braveSearch("q")).rejects.toThrow("connection refused");

  expect(fetched).toHaveLength(0);
  expect(inserts).toHaveLength(1);
});

test("a missing API key fails before a call is reserved", async () => {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  try {
    await expect(braveSearch("q")).rejects.toThrow("BRAVE_SEARCH_API_KEY is not set");
  } finally {
    process.env.BRAVE_SEARCH_API_KEY = key;
  }
  expect(inserts).toHaveLength(0);
  expect(fetched).toHaveLength(0);
});

test("onAttempt fires once per request actually sent, not per search", async () => {
  let attempts = 0;
  responses.push(json({}, { status: 500 }), json(webHit));
  await braveSearch("q", 5, { onAttempt: () => attempts++ });
  expect(attempts).toBe(2);
});
