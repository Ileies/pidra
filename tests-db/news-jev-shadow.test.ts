// src/news/jev-shadow.ts against real SQL with a synthetic Jev transport: only eligible stories are
// scored, only public fields leave, the ledger gets one row per story and task, and a failure never throws.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, jevDecisions, pipelineRuns } = await import("../src/db");
const { shadowNewsJev, PRIOR_HEADLINE_LIMIT } = await import("../src/news/jev-shadow");
const { traceRun } = await import("../src/util/trace");
const { JEV_MODEL } = await import("../src/ai/jev");

const scoreAnswer = { type: "score", score: 2.1, confidence: 0.7, legend: { 0: "a", 1: "b", 2: "c", 3: "d" }, probabilities: { 0: 0.05, 1: 0.15, 2: 0.6, 3: 0.2 } };
/** Answers whichever questions the request names, like the real endpoint. */
const bodies: { state: Record<string, unknown>; questions: Record<string, unknown> }[] = [];
const fetchOk = async (_url: unknown, init?: { body?: unknown }) => {
  const body = JSON.parse(String(init?.body));
  bodies.push(body);
  return Response.json({
    model: JEV_MODEL,
    answers: Object.fromEntries(Object.keys(body.questions).map((name) => [name, scoreAnswer])),
    usage: { input_tokens: 90, output_tokens: 10 },
  });
};
const fetchBad = async () => Response.json({ error: "bad" }, { status: 400 });
const fetchForbidden = () => { throw new Error("fetch must not run"); };

const story = (headline: string) => ({
  headline, summary: "Synthetic summary", context: "Synthetic context", significance: 3 as const, status: "new" as const,
  confidence: "confirmed" as const, region: "Synthetic region", topic: "politics", happened_at: "2026-10-05", entities: [], sources: [],
});
const clean = { verified: true, unverifiedUrls: [], inWindow: true, duplicateOf: null, alreadyReported: null };
const candidate = (headline: string, over: Record<string, unknown> = {}, stored = false) =>
  ({ desk: "world", deskOrder: 0, story: story(headline), validation: { ...clean, ...over }, stored }) as never;
const reported = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: `2026-10-${String(1 + (i % 4)).padStart(2, "0")}`, headline: `Prior ${i}`, urls: [],
}));

const ENV = ["JEV_MODE_NEWS_IMPACT", "JEV_MODE_NEWS_NOVELTY", "JEV_KEY"] as const;
const original = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
let runId = "";
beforeEach(async () => {
  bodies.length = 0;
  await database.sql`truncate pipeline_runs cascade`;
  [{ id: runId }] = await db.insert(pipelineRuns).values({ runDate: "2026-10-05" }).returning({ id: pipelineRuns.id });
  process.env.JEV_KEY = "synthetic-test-key";
  delete process.env.JEV_MODE_NEWS_IMPACT;
  delete process.env.JEV_MODE_NEWS_NOVELTY;
});
afterEach(() => {
  for (const name of ENV) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

const inRun = <T>(fn: () => Promise<T>) => traceRun(runId, fn);
const rows = () => db.select().from(jevDecisions);

describe("news shadow tasks", () => {
  test("off by default: no request, no row", async () => {
    const count = await inRun(() => shadowNewsJev([candidate("A")], [], { fetch: fetchForbidden as never }));
    expect(count).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  test("scores only stories that passed the checks and were not stored earlier", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const count = await inRun(() => shadowNewsJev([
      candidate("Kept"),
      candidate("Unverified", { verified: false }),
      candidate("Out of window", { inWindow: false }),
      candidate("Duplicate", { duplicateOf: { desk: "home", headline: "Kept" } }),
      candidate("Told before", { alreadyReported: { date: "2026-10-04", headline: "Told before" } }),
      candidate("Stored earlier", {}, true),
    ], [], { fetch: fetchOk as never }));
    expect(count).toBe(1);
    const [row] = await rows();
    expect(row.task).toBe("news_impact");
    expect(row.mode).toBe("shadow");
    expect(row.status).toBe("ok");
    expect(row.rubricVersion).toBe("code");
    expect(row.influencedReport).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies[0]!.state)).toContain("Kept");
    expect(JSON.stringify(bodies[0]!.state)).not.toContain("significance");
  });

  test("each task has its own mode and its own row per story", async () => {
    process.env.JEV_MODE_NEWS_NOVELTY = "shadow";
    expect(await inRun(() => shadowNewsJev([candidate("Kept")], [], { fetch: fetchOk as never }))).toBe(1);
    expect((await rows()).map((r) => r.task)).toEqual(["news_novelty"]);
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    expect(await inRun(() => shadowNewsJev([candidate("Kept")], [], { fetch: fetchOk as never }))).toBe(2);
    expect((await rows()).map((r) => r.task).sort()).toEqual(["news_impact", "news_novelty"]);
  });

  test("novelty sees the newest prior headlines, capped, and impact sees none", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_MODE_NEWS_NOVELTY = "shadow";
    await inRun(() => shadowNewsJev([candidate("Kept")], reported(PRIOR_HEADLINE_LIMIT + 10), { fetch: fetchOk as never }));
    const withPrior = bodies.filter((b) => "prior_headlines" in b.state);
    expect(withPrior).toHaveLength(1);
    const prior = withPrior[0]!.state.prior_headlines as { date: string; headline: string }[];
    expect(prior).toHaveLength(PRIOR_HEADLINE_LIMIT);
    expect(prior[0]!.date >= prior[prior.length - 1]!.date).toBe(true);
    expect(Object.keys(prior[0]!).sort()).toEqual(["date", "headline"]);
    expect(Object.keys(withPrior[0]!.questions)).toEqual(["novelty"]);
    expect(bodies.filter((b) => !("prior_headlines" in b.state))).toHaveLength(1);
  });

  test("a failed call is a ledger row and does not throw", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const count = await inRun(() => shadowNewsJev([candidate("Kept")], [], { fetch: fetchBad as never }));
    expect(count).toBe(1);
    const [row] = await rows();
    expect(row.status).toBe("error");
    expect(row.errorCode).toBe("provider");
  });

  test("a repeat in the same run does not add rows", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_MODE_NEWS_NOVELTY = "shadow";
    await inRun(() => shadowNewsJev([candidate("Kept")], [], { fetch: fetchOk as never }));
    await inRun(() => shadowNewsJev([candidate("Kept")], [], { fetch: fetchOk as never }));
    expect(await rows()).toHaveLength(2);
  });

  test("outside a traced run nothing is recorded", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    const count = await shadowNewsJev([candidate("Kept")], [], { fetch: fetchForbidden as never });
    expect(count).toBe(0);
  });
});
