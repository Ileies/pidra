import { afterEach, describe, expect, test } from "bun:test";
import { choice, noul, score } from "@typesafe-ai/sdk";
import { JEV_MODEL, runJevDecision, validJevResponse } from "../src/ai/jev";

const questions = {
  category: choice("Which kind of public event?", { policy: null, science: null }),
  impact: score("How broad is the public impact?", ["narrow", "regional", "global"]),
  novel: noul("Is this a new development?"),
};

const goodResponse = {
  model: JEV_MODEL,
  answers: {
    category: { type: "choice", choice: "policy", confidence: 0.8, probabilities: { policy: 0.9, science: 0.1 } },
    impact: { type: "score", score: 1.3, confidence: 0.7, legend: { 0: "narrow", 1: "regional", 2: "global" }, probabilities: { 0: 0.1, 1: 0.5, 2: 0.4 } },
    novel: { type: "noul", noul: 0.85 },
  },
  usage: { input_tokens: 120, output_tokens: 30 },
};

const originalMode = process.env.JEV_MODE_NEWS_IMPACT;
const originalKey = process.env.JEV_KEY;
afterEach(() => {
  if (originalMode === undefined) delete process.env.JEV_MODE_NEWS_IMPACT;
  else process.env.JEV_MODE_NEWS_IMPACT = originalMode;
  if (originalKey === undefined) delete process.env.JEV_KEY;
  else process.env.JEV_KEY = originalKey;
});

describe("Jev boundary", () => {
  test("rejects missing probability keys and malformed answers", () => {
    expect(validJevResponse(goodResponse, questions)).toBe(true);
    expect(validJevResponse({ ...goodResponse, answers: {
      ...goodResponse.answers,
      category: { ...goodResponse.answers.category, probabilities: { policy: 1 } },
    } }, questions)).toBe(false);
    expect(validJevResponse({ ...goodResponse, answers: {
      ...goodResponse.answers,
      novel: { type: "noul", noul: 2 },
    } }, questions)).toBe(false);
  });

  test("off mode makes no request", async () => {
    delete process.env.JEV_MODE_NEWS_IMPACT;
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      fetch: () => { throw new Error("fetch must not run"); },
    });
    expect(result.status).toBe("off");
  });

  test("missing key produces a typed fallback result", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    delete process.env.JEV_KEY;
    const result = await runJevDecision({ task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("missing_key");
  });

  test("validates the SDK response and records usage", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      fetch: async () => Response.json(goodResponse),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.tokensIn).toBe(120);
      expect(result.answers.category.probabilities).toEqual({ policy: 0.9, science: 0.1 });
    }
  });

  test("invalid provider JSON returns an error result", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      fetch: async () => Response.json({ ...goodResponse, answers: {
        ...goodResponse.answers,
        category: { ...goodResponse.answers.category, probabilities: { policy: 1 } },
      } }),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("invalid_response");
  });

  test("caller cancellation returns a typed result before a request", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    const controller = new AbortController();
    controller.abort();
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      signal: controller.signal,
      fetch: () => { throw new Error("fetch must not run"); },
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("cancelled");
  });

  test("the total deadline stops a stalled provider", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      deadlineMs: 30,
      fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("deadline");
  });

  test("429 and 529 are retried by the SDK", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    let calls = 0;
    const result = await runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      fetch: async () => {
        calls++;
        return calls === 1 ? Response.json({ error: "busy" }, { status: 429, headers: { "retry-after-ms": "1" } })
          : calls === 2 ? Response.json({ error: "busy" }, { status: 529, headers: { "retry-after-ms": "1" } })
          : Response.json(goodResponse);
      },
    });
    expect(result.status).toBe("ok");
    expect(calls).toBe(3);
  });

  test("limits simultaneous provider calls", async () => {
    process.env.JEV_MODE_NEWS_IMPACT = "shadow";
    process.env.JEV_KEY = "synthetic-test-key";
    let entered = 0;
    let concurrent = 0;
    let peak = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const calls = Array.from({ length: 5 }, () => runJevDecision({
      task: "news_impact", rubricVersion: "synthetic-v1", state: "Synthetic public event", questions,
      fetch: async () => {
        entered++;
        peak = Math.max(peak, ++concurrent);
        await hold;
        concurrent--;
        return Response.json(goodResponse);
      },
    }));
    await Bun.sleep(10);
    expect(entered).toBe(4);
    release();
    expect((await Promise.all(calls)).every((result) => result.status === "ok")).toBe(true);
    expect(peak).toBe(4);
  });
});
