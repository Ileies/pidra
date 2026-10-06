// src/news/jev-shadow.ts against real SQL with a synthetic Jev transport: only eligible stories are
// scored, only public fields leave, the ledger gets one row each, and a failure never throws. No mocks.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, jevDecisions, pipelineRuns } = await import("../src/db");
const { shadowNewsImpact } = await import("../src/news/jev-shadow");
const { traceRun } = await import("../src/util/trace");
const { JEV_MODEL } = await import("../src/ai/jev");

const answer = {
  model: JEV_MODEL,
  answers: { impact: { type: "score", score: 2.1, confidence: 0.7, legend: { 0: "a", 1: "b", 2: "c", 3: "d" }, probabilities: { 0: 0.05, 1: 0.15, 2: 0.6, 3: 0.2 } } },
  usage: { input_tokens: 90, output_tokens: 10 },
};

const story = (headline: string) => ({
  headline, summary: "Synthetic summary", context: "Synthetic context", significance: 3 as const, status: "new" as const,
  confidence: "confirmed" as const, region: "Synthetic region", topic: "politics", happened_at: "2026-10-05", entities: [], sources: [],
});
const clean = { verified: true, unverifiedUrls: [], inWindow: true, duplicateOf: null, alreadyReported: null };
const candidate = (headline: string, over: Record<string, unknown> = {}, stored = false) =>
  ({ desk: "world", deskOrder: 0, story: story(headline), validation: { ...clean, ...over }, stored }) as never;

const originalMode = process.env.JEV_MODE_NEWS_IMPACT;
const originalKey = process.env.JEV_KEY;
let runId = "";
beforeEach(async () => {
  await database.sql`truncate pipeline_runs cascade`;
  [{ id: runId }] = await db.insert(pipelineRuns).values({ runDate: "2026-10-05" }).returning({ id: pipelineRuns.id });
  process.env.JEV_KEY = "synthetic-test-key";
});
afterEach(() => {
  if (originalMode === undefined) delete process.env.JEV_MODE_NEWS_IMPACT;
  else process.env.JEV_MODE_NEWS_IMPACT = originalMode;
  if (originalKey === undefined) delete process.env.JEV_KEY;
  else process.env.JEV_KEY = originalKey;
});

const inRun = <T>(fn: () => Promise<T>) => traceRun(runId, fn);
const rows = () => db.select().from(jevDecisions);

describe("news impact shadow", () => {
  test("off by default: no request, no row", async () => {
    delete process.env.JEV_MODE_NEWS_IMPACT;
    const count = await inRun(() => shadowNewsImpact([candidate("A")], { fetch: () => { throw new Error("fetch must not run"); } }));
    expect(count).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  test("scores only stories that passed the checks and were not stored earlier", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const bodies: string[] = [];
    const fetch = async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body));
      return Response.json(answer);
    };
    const count = await inRun(() => shadowNewsImpact([
      candidate("Kept"),
      candidate("Unverified", { verified: false }),
      candidate("Out of window", { inWindow: false }),
      candidate("Duplicate", { duplicateOf: { desk: "home", headline: "Kept" } }),
      candidate("Told before", { alreadyReported: { date: "2026-10-04", headline: "Told before" } }),
      candidate("Stored earlier", {}, true),
    ], { fetch: fetch as never }));
    expect(count).toBe(1);
    const [row] = await rows();
    expect(row.task).toBe("news_impact");
    expect(row.mode).toBe("shadow");
    expect(row.status).toBe("ok");
    expect(row.rubricVersion).toBe("code");
    expect(row.influencedReport).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Kept");
    expect(bodies[0]).not.toContain("significance");
  });

  test("a failed call is a ledger row and does not throw", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const fetch = async () => Response.json({ error: "bad" }, { status: 400 });
    const count = await inRun(() => shadowNewsImpact([candidate("Kept")], { fetch: fetch as never }));
    expect(count).toBe(1);
    const [row] = await rows();
    expect(row.status).toBe("error");
    expect(row.errorCode).toBe("provider");
  });

  test("a repeat in the same run does not add rows", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const fetch = async () => Response.json(answer);
    await inRun(() => shadowNewsImpact([candidate("Kept")], { fetch: fetch as never }));
    await inRun(() => shadowNewsImpact([candidate("Kept")], { fetch: fetch as never }));
    expect(await rows()).toHaveLength(1);
  });

  test("outside a traced run nothing is recorded", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const count = await shadowNewsImpact([candidate("Kept")], { fetch: (() => { throw new Error("fetch must not run"); }) as never });
    expect(count).toBe(0);
  });
});
