// src/news/research.ts, driven through `runNewsDesk` against real SQL with the model and the Brave
// client stubbed (tests-db/fixtures/news-desks.ts): the search rounds, how the model's queries are
// cleaned and topped up, how cited ids become URLs, and what a desk that fails reports it spent.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";
import {
  braveCalls, DAY, defaultStories, loadContext, modelCalls, NOW, resetNewsDesks, storedDeliveries, storedStories, stub, type Any,
} from "./fixtures/news-desks";

const database = await useTestDatabase();
const { runNewsDesk } = await import("../src/news/run");
const { SEARCH_BUDGET } = await import("../src/news/config");

const run = (date = DAY, now = NOW, extra: Any = {}) => runNewsDesk(date, { now, loadContext, ...extra });
const cite = (...sources: { id: string; publisher: string }[]) => (desk: string) => [{ ...defaultStories(desk)[0], sources }];
const finalCall = () => modelCalls.find((c) => c.kind === "final")!;

beforeEach(() => resetNewsDesks(database));

describe("one desk's research", () => {
  test("plans a news round, then a context round, within the desk's budget", async () => {
    const outcome = await run();
    const [news, context] = SEARCH_BUDGET.world;

    expect(braveCalls.map((c) => c.kind)).toEqual([...Array(news).fill("news"), ...Array(context).fill("context")]);
    expect(modelCalls.map((c) => c.kind)).toEqual(["queries", "queries", "final"]);
    expect(modelCalls[1].input.prior_queries).toHaveLength(news);
    expect(modelCalls[1].input.first_results[0].results[0]).toEqual({ title: "Title a", description: expect.any(String), age: "2 hours ago" });
    expect(outcome.desks).toEqual([{ desk: "world", status: "ran", stories: 1, searchCalls: news + context, queries: expect.any(Array) }]);
    expect(outcome.desks[0].queries).toHaveLength(news + context);
    expect(outcome).toMatchObject({ aiCalls: 3, searchCalls: 6, tokensIn: 300, tokensOut: 60, failures: [] });
  });

  test("searches the calendar window, and localises only the desks that are about a place", async () => {
    process.env.NEWS_DESKS = "world,home,talk";
    process.env.NEWS_HOME_COUNTRY = "ch";
    process.env.NEWS_HOME_CITY = "Zurich";
    await run();

    const countryOf = (desk: string, kind: "news" | "context") =>
      new Set(braveCalls.filter((c) => c.query.startsWith(desk) && c.kind === kind).map((c) => c.options.country));
    expect(braveCalls.every((c) => c.options.freshness === "2026-10-04to2026-10-05")).toBe(true);
    expect(countryOf("home", "news")).toEqual(new Set(["CH"]));
    expect(countryOf("talk", "news")).toEqual(new Set(["CH"]));
    expect(countryOf("world", "news")).toEqual(new Set(["ALL"]));
    expect(countryOf("world", "context")).toEqual(new Set([undefined]));
  });

  test("attaches the exact result URL and title to the ids the model cites", async () => {
    stub.stories = cite({ id: "s2", publisher: "  " }, { id: "s99", publisher: "Nobody" });
    await run();

    const [row] = await storedStories(database);
    expect(row.json.sources).toHaveLength(1);
    expect(row.json.sources[0]).toMatchObject({ publisher: "news.example.com", title: "Title b", url: "https://news.example.com/world-story-1-first/b" });
    expect(row.json.validation).toMatchObject({ verified: true, unverifiedUrls: [] });
  });

  test("a story whose every cited id is unknown is stored unverified", async () => {
    stub.stories = cite({ id: "s99", publisher: "Nobody" });
    await run();

    const [row] = await storedStories(database);
    expect(row.json.sources).toEqual([]);
    expect(row.json.validation.verified).toBe(false);
  });

  test("shows the model at most 12 results per search, so ids past that are unknown", async () => {
    stub.braveResults = (query) => Array.from({ length: 15 }, (_, i) => ({ title: `T${i}`, url: `https://news.example.com/${query.replaceAll(" ", "-")}/${i}`, description: "d" }));
    stub.stories = cite({ id: "s1", publisher: "A" }, { id: "s73", publisher: "B" });
    await run();

    expect(finalCall().input.searches.every((s: Any) => s.results.length === 12)).toBe(true);
    const ids = finalCall().input.searches.flatMap((s: Any) => s.results.map((r: Any) => r.id));
    expect(ids).toHaveLength(72);
    expect(new Set(ids).size).toBe(72);
    expect(ids).not.toContain("s73");
    const [row] = await storedStories(database);
    expect(row.json.sources.map((s: Any) => s.publisher)).toEqual(["A"]);
  });

  test("the final call gets the desk's effort, and NEWS_REASONING_EFFORT overrides it", async () => {
    await run();
    expect(finalCall().options.reasoningEffort).toBe("high");
    expect(modelCalls.find((c) => c.kind === "queries")!.options.reasoningEffort).toBe("medium");

    for (const [setting, effort] of [[" LOW ", "low"], ["turbo", "high"]]) {
      await resetNewsDesks(database);
      process.env.NEWS_REASONING_EFFORT = setting;
      await run();
      expect(finalCall().options.reasoningEffort).toBe(effort);
    }
  });
});

describe("the queries that are sent", () => {
  test("drops first-person wording, URLs, operators and duplicates, and tops up from the fallback", async () => {
    stub.proposed = (_desk, followUp) => followUp
      ? ["ceasefire talks update"]
      : ["my email provider", "https://example.com/x ceasefire talks", "(oil OR gas) prices after:2026-10-01", "Oil Gas prices", "oil gas prices", "abc", "site:example.com tariffs"];
    await run();

    const sent = braveCalls.map((c) => c.query);
    const [first, second] = SEARCH_BUDGET.world;
    expect(sent.slice(0, first)).toEqual(["ceasefire talks", "oil gas prices", "tariffs", "world breaking news"]);
    expect(sent.slice(first)).toHaveLength(second);
    expect(sent[first]).toBe("ceasefire talks update");
    expect(new Set(sent.map((q) => q.toLowerCase())).size).toBe(sent.length);
    expect(sent.some((q) => /@|\bmy\b|site:|https?:|after:/i.test(q))).toBe(false);
  });

  test("keeps site: only for the beat and field desks", async () => {
    process.env.NEWS_DESKS = "beat";
    stub.proposed = () => ["site:example.com chips launch", "chips regulation"];
    await run();
    expect(braveCalls[0].query).toBe("site:example.com chips launch");
  });

  test("caps a query at 110 characters on a word boundary", async () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    stub.proposed = () => [long];
    await run();
    expect(braveCalls[0].query.length).toBeLessThanOrEqual(110);
    expect(long.startsWith(braveCalls[0].query)).toBe(true);
  });

  test("a model that returns nothing is replaced by the desk's fallback queries", async () => {
    process.env.NEWS_DESKS = "world,talk";
    process.env.NEWS_HOME_COUNTRY = "CH";
    stub.proposed = () => [];
    const outcome = await run();

    expect(outcome.failures).toEqual([]);
    const sent = braveCalls.map((c) => c.query);
    expect(sent).toContain("world breaking news");
    expect(sent).toContain("trending culture entertainment");
    expect(sent).toContain("Switzerland talked about today");
  });

  test("reader-derived text reaches a fallback query only when it looks like a topic", async () => {
    process.env.NEWS_DESKS = "beat";
    await database.sql`insert into notes (scope, content, created_at) values ('intel', 'my salary history at user@example.com', now() - interval '2 minutes'), ('intel', 'Quantum computing', now() - interval '1 minute')`;
    stub.proposed = () => [];
    await run();

    const sent = braveCalls.map((c) => c.query);
    expect(sent[0]).toBe("technology latest news");
    expect(sent.every((q) => !/salary|example\.com/.test(q))).toBe(true);
  });
});

describe("a desk whose research fails", () => {
  test("a missing Brave key fails the desk before anything is spent", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    const outcome = await run();
    expect(outcome.desks).toEqual([{ desk: "world", status: "failed", stories: 0, searchCalls: 0, error: "BRAVE_SEARCH_API_KEY is not set" }]);
    expect(outcome.failures).toEqual([{ source: "news:world", error: "BRAVE_SEARCH_API_KEY is not set" }]);
    expect(modelCalls).toHaveLength(0);
    expect(await storedDeliveries(database)).toEqual([]);
  });

  test("Brave returning nothing at all fails the desk and still counts the requests", async () => {
    stub.braveResults = () => [];
    const outcome = await run();
    expect(outcome.desks[0]).toMatchObject({ status: "failed", error: "Brave returned no sources for this desk", searchCalls: 6 });
    expect(outcome).toMatchObject({ searchCalls: 6, aiCalls: 2 });
    expect(await storedDeliveries(database)).toEqual([]);
  });

  test("a search that fails in the second round reports what was spent", async () => {
    const quota = "Brave Search daily limit of 30 requests reached";
    stub.braveFailure = (call) => (call.kind === "context" && call.query.includes("2 followup") ? new Error(quota) : null);
    const outcome = await run();
    expect(outcome.desks[0]).toMatchObject({ status: "failed", error: quota, searchCalls: 6 });
    expect(outcome.failures).toEqual([{ source: "news:world", error: quota }]);
    expect(outcome.tokensIn).toBe(200);
    expect(await storedStories(database)).toEqual([]);
  });

  test("a failure in the final answer still reports every search that was paid for", async () => {
    process.env.NEWS_DESKS = "serendipity";
    stub.proposed = () => ["x"];
    stub.modelFailure = (call) => (call.kind === "final" ? new Error("model refused") : null);
    const failed = await run();
    expect(failed.desks[0]).toMatchObject({ status: "failed", error: "model refused", searchCalls: 3 });
    expect(failed.searchCalls).toBe(3);
  });
});
