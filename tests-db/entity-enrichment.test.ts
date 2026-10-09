// src/pipeline/entity-enrichment.ts against real SQL: which entities the agent takes, what each
// terminal tool does to the entity and the queue. The model and the web search are the only mocks.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Any = Record<string, any>;
let script: Any[][] = [];
let turns = 0;

mock.module("../src/ai/openai", () => ({
  extractJson: async () => { throw new Error("not expected"); },
  synthesize: async () => { throw new Error("not expected"); },
  converse: async () => {
    const calls = script[turns++] ?? [];
    return { text: "", output: [], functionCalls: calls.map((c, i) => ({ callId: `c${turns}_${i}`, name: c.name, argumentsJson: JSON.stringify(c.args ?? {}) })), tokensIn: 10, tokensOut: 5 };
  },
  usageTally: () => {
    const tally = { tokensIn: 0, tokensOut: 0, onUsage(i: number, o: number) { tally.tokensIn += i; tally.tokensOut += o; } };
    return tally;
  },
}));
mock.module("../src/search/brave", () => ({ braveSearch: async () => ({ query: "q", results: [{ title: "T", url: "https://example.com", description: "d" }] }) }));

const database = await useTestDatabase();
const { runEntityEnrichment } = await import("../src/pipeline/entity-enrichment");

const DAY = "2026-10-09";
const context = { corrections: [], intelSections: "", personalSections: "", interestSections: "", generatedAt: null, problem: null } as never;
const entity = (name: string, mentions = 4) =>
  database.sql`insert into entities (name, type, status, mention_count, first_seen) values (${name}, 'concept', 'active', ${mentions}, '2026-09-01')`;
const queue = async () => (await database.sql`select question, status, status_detail, sources from questions order by created_at`) as Any[];

beforeEach(async () => {
  script = [];
  turns = 0;
  await database.sql`truncate questions, entities cascade`;
});

describe("entity enrichment", () => {
  test("records what a public entity is and asks nothing", async () => {
    await entity("TypeScript");
    script = [[{ name: "record_entity", args: { type: "tech", domain: "Dev", summary: "A typed superset of JavaScript." } }]];
    const result = await runEntityEnrichment(DAY, context);

    expect(result).toMatchObject({ enriched: 1, asked: 0 });
    const [row] = await database.sql`select type, domain, summary from entities`;
    expect(row).toEqual({ type: "tech", domain: "Dev", summary: "A typed superset of JavaScript." });
    expect(await queue()).toHaveLength(0);
  });

  test("searches first when it needs to, and a question it writes is the model's own wording", async () => {
    await entity("Obscure Project");
    script = [[{ name: "search_web", args: { query: "Obscure Project" } }], [{ name: "ask_reader", args: { question: "Is Obscure Project something you build?", why: "no source places it" } }]];
    const result = await runEntityEnrichment(DAY, context);

    expect(result).toMatchObject({ enriched: 0, asked: 1 });
    expect((await queue())[0]).toMatchObject({ question: "Is Obscure Project something you build?", status: "open" });
  });

  test("gives up on a stray token and never looks at it again", async () => {
    await entity("zx_handle");
    script = [[{ name: "give_up", args: { reason: "a handle from boilerplate" } }]];
    await runEntityEnrichment(DAY, context);
    expect((await queue())[0]).toMatchObject({ status: "resolved" });

    script = [[{ name: "record_entity", args: { type: "tech", domain: "Dev", summary: "x" } }]];
    turns = 0;
    expect(await runEntityEnrichment(DAY, context)).toMatchObject({ enriched: 0, asked: 0, gaveUp: 0 });
  });

  test("takes over an entity with an open template question and closes that question", async () => {
    await entity("TypeScript");
    const [e] = await database.sql`select id from entities`;
    await database.sql`insert into questions (kind, question, sources, first_asked, last_asked) values ('item', 'TypeScript has come up 6 times, what is it?', ${JSON.stringify([{ extraction_id: `entity:${e.id}`, from: "TypeScript", subject: null, source_type: "entity", run_date: DAY }])}::jsonb, ${DAY}::date, ${DAY}::date)`;
    script = [[{ name: "record_entity", args: { type: "tech", domain: "Dev", summary: "A typed superset of JavaScript." } }]];
    await runEntityEnrichment(DAY, context);

    expect((await queue())[0]).toMatchObject({ status: "resolved" });
  });

  test("skips entities that are rarely cited, already described or locked", async () => {
    await entity("Rare", 2);
    await entity("Described");
    await entity("Locked");
    await database.sql`update entities set summary = 'known' where name = 'Described'`;
    await database.sql`update entities set locked = true where name = 'Locked'`;
    expect(await runEntityEnrichment(DAY, context)).toMatchObject({ enriched: 0, asked: 0, gaveUp: 0 });
    expect(turns).toBe(0);
  });
});
