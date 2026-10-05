// Protects the OpenAI API rules in CLAUDE.md as they apply to the one client in src/ai/openai.ts:
// every Responses call carries store:false and the flex tier, never temperature, max_tokens or a
// hosted web_search tool; 429, 5xx and connection errors are retried with the flex backoff and
// anything else is not; the speech endpoint is the one call without store and service_tier.
// The `openai` package is a fake that records the exact params; Bun.sleep is a spy.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

type Params = Record<string, unknown>;
type Reply = { status?: string; output_text?: string; output?: unknown[]; usage?: { input_tokens: number; output_tokens: number }; incomplete_details?: { reason: string } };

let responseCalls: Params[] = [];
let speechCalls: Params[] = [];
let script: (Reply | Error)[] = [];
let speechScript: (Error | null)[] = [];
let sleeps: number[] = [];
let sleepSpy: ReturnType<typeof spyOn>;

class FakeOpenAI {
  responses = {
    create: async (params: Params) => {
      responseCalls.push(params);
      const next = script.shift() ?? { output_text: "{}", usage: { input_tokens: 1, output_tokens: 1 } };
      if (next instanceof Error) throw next;
      return { status: "completed", output: [], ...next };
    },
  };
  audio = {
    speech: {
      create: async (params: Params) => {
        speechCalls.push(params);
        const failure = speechScript.shift();
        if (failure) throw failure;
        return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      },
    },
  };
}

mock.module("openai", () => ({ default: FakeOpenAI }));
process.env.OPENAI_API_KEY ??= "test-key";
const { extractJson, synthesize, converse, speak, withFlexRetry, usageTally } = await import("../src/ai/openai?openai-rules-test");

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const named = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  responseCalls = [];
  speechCalls = [];
  script = [];
  speechScript = [];
  sleeps = [];
  sleepSpy = spyOn(Bun, "sleep").mockImplementation((async (ms: number) => {
    sleeps.push(Number(ms));
  }) as typeof Bun.sleep);
});

afterEach(() => sleepSpy.mockRestore());

function expectRules(params: Params) {
  expect(params.store).toBe(false);
  expect(params.service_tier).toBe("flex");
  expect(params).not.toHaveProperty("temperature");
  expect(params).not.toHaveProperty("max_tokens");
  expect(typeof params.max_output_tokens).toBe("number");
  const tools = (params.tools ?? []) as { type: string }[];
  expect(tools.some((t) => t.type.startsWith("web_search"))).toBe(false);
}

test("extractJson, synthesize and converse all send store:false, flex, max_output_tokens and no temperature", async () => {
  script.push({ output_text: '{"a":1}' });
  expect(await extractJson("sys", "user")).toEqual({ a: 1 });
  script.push({ output_text: "text" });
  await synthesize("sys", "user");
  script.push({ output_text: "text" });
  await converse("sys", [{ role: "user", content: "hi" }], { tools: [{ type: "function", name: "t", description: "", parameters: {}, strict: false }] });

  expect(responseCalls).toHaveLength(3);
  responseCalls.forEach(expectRules);
});

test("extractJson defaults: low effort, a 2000 token cap, json_object without a schema, strict json_schema with one", async () => {
  script.push({ output_text: "{}" }, { output_text: "{}" });
  await extractJson("sys", "user");
  await extractJson("sys", "user", { schema: { name: "s", schema: { type: "object" } }, maxOutputTokens: 500, reasoningEffort: "medium" });

  expect(responseCalls[0]).toMatchObject({ max_output_tokens: 2000, reasoning: { effort: "low" }, text: { format: { type: "json_object" } } });
  expect(String(responseCalls[0].input)).toMatch(/json/i);
  expect(responseCalls[1]).toMatchObject({ max_output_tokens: 500, reasoning: { effort: "medium" }, text: { format: { type: "json_schema", name: "s", strict: true } } });
});

test("synthesize and converse defaults", async () => {
  await synthesize("sys", "user");
  await converse("sys", []);

  expect(responseCalls[0]).toMatchObject({ max_output_tokens: 4096, reasoning: { effort: "medium" }, instructions: "sys" });
  expect(responseCalls[1]).toMatchObject({ max_output_tokens: 4096, reasoning: { effort: "low" } });
  expect(responseCalls[1]).not.toHaveProperty("tools");
});

test("converse passes tools with tool_choice auto, and reports the function calls the model made", async () => {
  script.push({ output_text: "", output: [{ type: "function_call", call_id: "c1", name: "write_note", arguments: '{"x":1}' }, { type: "message" }] });
  const out = await converse("sys", [], { tools: [{ type: "function", name: "write_note", description: "", parameters: {}, strict: false }] });

  expect(responseCalls[0].tool_choice).toBe("auto");
  expect(out.functionCalls).toEqual([{ callId: "c1", name: "write_note", argumentsJson: '{"x":1}' }]);
  expect(out.output).toHaveLength(2);
});

test("an incomplete extraction is retried once with a 4x ceiling, and a second one throws with the reason", async () => {
  script.push({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, { output_text: '{"ok":true}' });
  expect(await extractJson("sys", "user")).toEqual({ ok: true });
  expect(responseCalls.map((p) => p.max_output_tokens)).toEqual([2000, 8000]);

  responseCalls = [];
  script.push({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  await expect(extractJson("sys", "user")).rejects.toThrow("incomplete after 2 attempts: max_output_tokens");
  expect(responseCalls).toHaveLength(2);
});

test("an empty extraction throws instead of parsing nothing", async () => {
  script.push({ output_text: "" });
  await expect(extractJson("sys", "user")).rejects.toThrow("Empty response");
});

test("token usage reaches the callback and the tally, and a missing usage counts as zero", async () => {
  const tally = usageTally();
  script.push({ output_text: "a", usage: { input_tokens: 10, output_tokens: 4 } }, { output_text: "b", usage: { input_tokens: 5, output_tokens: 1 } }, { output_text: "c", usage: undefined });
  const first = await synthesize("s", "u", { onUsage: tally.onUsage });
  await synthesize("s", "u", { onUsage: tally.onUsage });
  await synthesize("s", "u", { onUsage: tally.onUsage });

  expect(first).toMatchObject({ tokensIn: 10, tokensOut: 4 });
  expect(tally).toMatchObject({ tokensIn: 15, tokensOut: 5 });
});

test("control characters are stripped from the user content before it is sent", async () => {
  await synthesize("sys", "a\u0000b\u0007c");
  expect(responseCalls[0].input).toBe("abc");
});

test("a 429 is retried with the flex backoff (2 s, then 8 s) and the same params every time", async () => {
  script.push(httpError(429), httpError(429), { output_text: "done" });
  const out = await synthesize("sys", "user");

  expect(out.text).toBe("done");
  expect(responseCalls).toHaveLength(3);
  expect(sleeps).toEqual([2000, 8000]);
  responseCalls.forEach(expectRules);
  expect(responseCalls[2]).toEqual(responseCalls[0]);
});

test("the flex retry gives up after four tries with the last error, waiting 2 s, 8 s and 20 s", async () => {
  script.push(httpError(429), httpError(500), httpError(503), httpError(429));

  await expect(synthesize("sys", "user")).rejects.toMatchObject({ status: 429 });

  expect(responseCalls).toHaveLength(4);
  expect(sleeps).toEqual([2000, 8000, 20000]);
});

test("5xx and connection errors are retried; other 4xx and plain errors are not", async () => {
  script.push(httpError(502), named("APIConnectionError"), named("APIConnectionTimeoutError"), { output_text: "ok" });
  expect((await synthesize("s", "u")).text).toBe("ok");
  expect(responseCalls).toHaveLength(4);

  for (const err of [httpError(400), httpError(401), httpError(404), new Error("boom")]) {
    responseCalls = [];
    script.push(err, { output_text: "never" });
    await expect(synthesize("s", "u")).rejects.toBe(err);
    expect(responseCalls).toHaveLength(1);
    script.length = 0;
  }
});

test("withFlexRetry is usable on its own and counts a retry per wait", async () => {
  let calls = 0;
  const result = await withFlexRetry(async () => {
    if (++calls < 2) throw httpError(429);
    return "fine";
  });
  expect(result).toBe("fine");
  expect(sleeps).toEqual([2000]);
});

test("speech is the one call without store and service_tier, and it keeps the retry", async () => {
  speechScript.push(httpError(429), null);
  const mp3 = await speak("Good morning.");

  expect(speechCalls).toHaveLength(2);
  for (const params of speechCalls) {
    expect(params).not.toHaveProperty("store");
    expect(params).not.toHaveProperty("service_tier");
    expect(params).toMatchObject({ input: "Good morning.", response_format: "mp3" });
  }
  expect(sleeps).toEqual([2000]);
  expect([...mp3]).toEqual([1, 2, 3]);
  expect(responseCalls).toHaveLength(0);
});
