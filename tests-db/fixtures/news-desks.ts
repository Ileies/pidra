// Shared by tests-db/news-research.test.ts and news-run.test.ts: stubs for the model and the Brave
// client (the only network edges of a news desk run), installed on import, and the helpers around them.
// Import this before `src/news/*`. Set fields on `stub` in a test; `resetNewsDesks()` restores them.
import { mock } from "bun:test";
import type { TestDatabase } from "./database";

export type Any = Record<string, any>;
export type ModelCall = { kind: "queries" | "final"; desk: string; input: Any; options: Any };
export type BraveCall = { kind: "news" | "context"; query: string; options: Any };

export const modelCalls: ModelCall[] = [];
export const braveCalls: BraveCall[] = [];
/** The repeat judge's inputs, kept apart from `modelCalls`, which counts the desks' own calls. */
export const judgeCalls: Any[] = [];
export const prompts: string[] = [];
export const contextLoads: number[] = [];

export const HEADLINES: Record<string, string> = {
  world: "Parliament approves the national budget",
  home: "Zurich tram line reopens after repairs",
  beat: "Chipmaker unveils a faster processor",
  field: "Telescope finds a rocky exoplanet",
  talk: "Film festival award surprises critics",
  serendipity: "Otter learns to juggle pebbles",
};

export const DAY = "2026-10-05";
export const NOW = new Date("2026-10-05T05:00:00Z");

const defaults = {
  // What the model proposes, by desk and round; more than any desk's budget, so the cleaning decides.
  proposed: (desk: string, followUp: boolean): string[] =>
    Array.from({ length: 8 }, (_, i) => `${desk} story ${i + 1} ${followUp ? "followup" : "first"}`),
  // One in-window story citing the first result.
  stories: (desk: string, _input?: Any): Any[] => [{
    headline: HEADLINES[desk], summary: `${HEADLINES[desk]}, in short`, context: "", significance: 4, status: "new",
    confidence: "confirmed", region: desk === "home" ? "Switzerland" : "global", topic: "news",
    happened_at: "2026-10-05T01:00:00Z", entities: [desk], sources: [{ id: "s1", publisher: "Example News" }],
  }],
  // The repeat judge: by default it finds nothing, so a test that is not about it sees no change.
  judgement: (_input: Any): Any => ({ repeats: [], groups: [] }),
  judgeFailure: null as Error | null,
  modelFailure: null as ((call: ModelCall) => Error | null) | null,
  braveFailure: null as ((call: BraveCall) => Error | null) | null,
  braveResults: (query: string): Any[] =>
    ["a", "b", "c"].map((n) => ({ title: `Title ${n}`, url: `https://news.example.com/${query.replaceAll(" ", "-")}/${n}`, description: `About ${query}`, age: "2 hours ago" })),
};

export const stub = { ...defaults };
export const defaultStories = defaults.stories;

// The desk is read off what the payload contains, the way the prompts tell the desks apart.
function deskOf(input: Any): string {
  const d = input.desk_input;
  if ("beat_desk" in d) return "field";
  if ("reader_notes" in d) return "talk";
  if ("avoid" in d) return "serendipity";
  if ("priorities" in d) return "beat";
  if ("home" in d) return "home";
  return "world";
}

mock.module("../../src/ai/openai", () => ({
  EXTRACTION_MODEL: "test-model",
  extractJson: async (_instructions: string, input: string, options: Any) => {
    const parsed = JSON.parse(input);
    if (options.schema.name === "news_repeat_judgement") {
      judgeCalls.push(parsed);
      options.onUsage?.(50, 10);
      if (stub.judgeFailure) throw stub.judgeFailure;
      return stub.judgement(parsed);
    }
    const final = options.schema.name === "news_desk";
    const call: ModelCall = { kind: final ? "final" : "queries", desk: deskOf(parsed), input: parsed, options };
    modelCalls.push(call);
    const failure = stub.modelFailure?.(call);
    if (failure) throw failure;
    options.onUsage?.(100, 20);
    return final ? { stories: stub.stories(call.desk, parsed) } : { queries: stub.proposed(call.desk, parsed.prior_queries.length > 0) };
  },
  usageTally: () => {
    const tally = { tokensIn: 0, tokensOut: 0, onUsage(i: number, o: number) { tally.tokensIn += i; tally.tokensOut += o; } };
    return tally;
  },
}));
mock.module("../../src/ai/active-prompts", () => ({
  activePrompt: async (section: string) => { prompts.push(section); return { section, text: `mandate for ${section}`, version: 7 }; },
  // Only read by the Jev shadow task, which stays off in these tests.
  resolveActivePrompts: async () => { throw new Error("not stubbed"); },
}));

async function brave(kind: BraveCall["kind"], query: string, options: Any) {
  const call = { kind, query, options };
  braveCalls.push(call);
  options.onAttempt?.();
  const failure = stub.braveFailure?.(call);
  if (failure) throw failure;
  return { query, results: stub.braveResults(query) };
}
mock.module("../../src/search/brave", () => ({
  braveSearch: (query: string, _count: number, options: Any) => brave("news", query, options),
  braveContext: (query: string, options: Any) => brave("context", query, options),
}));

export const loadContext = async () => {
  contextLoads.push(1);
  return { interestSections: "Interest: sailing", intelSections: "", personalSections: "", corrections: [], generatedAt: null, problem: null } as never;
};

const ENV = ["BRAVE_SEARCH_API_KEY", "NEWS_DESKS", "NEWS_HOME_COUNTRY", "NEWS_HOME_CITY", "NEWS_HOME_REGION", "NEWS_ALSO_COUNTRIES", "NEWS_REASONING_EFFORT"];

/** For `beforeEach`: no recorded calls, default stubs, a Brave key and only the world desk enabled. */
export async function resetNewsDesks(database: TestDatabase) {
  modelCalls.length = 0;
  braveCalls.length = 0;
  judgeCalls.length = 0;
  prompts.length = 0;
  contextLoads.length = 0;
  Object.assign(stub, defaults);
  for (const name of ENV) delete process.env[name];
  process.env.BRAVE_SEARCH_API_KEY = "test-key";
  process.env.NEWS_DESKS = "world";
  await database.sql`truncate raw_items, extractions, notes cascade`;
}

export const storedStories = async (database: TestDatabase) =>
  (await database.sql`select e.extracted_json as json, e.run_date::text as run_date, r.source_name from extractions e join raw_items r on r.id = e.raw_item_id order by r.source_name, e.id`) as Any[];

export const storedDeliveries = async (database: TestDatabase) =>
  (await database.sql`select source_name, message_id, raw_content from raw_items order by source_name`) as Any[];
