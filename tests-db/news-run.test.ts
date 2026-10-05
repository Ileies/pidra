// src/news/run.ts against real SQL with the model and the Brave client stubbed
// (tests-db/fixtures/news-desks.ts): what each desk is shown, what the run reports for a desk that
// fails, is unconfigured or is reused, and what is stored. The research itself is news-research.test.ts.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";
import {
  contextLoads, DAY, defaultStories, HEADLINES, loadContext, modelCalls, NOW, prompts, resetNewsDesks, storedDeliveries, storedStories, stub, type Any,
} from "./fixtures/news-desks";

const database = await useTestDatabase();
const { runNewsDesk } = await import("../src/news/run");
const { SEARCH_BUDGET } = await import("../src/news/config");

const run = (date = DAY, now = NOW, extra: Any = {}) => runNewsDesk(date, { now, loadContext, ...extra });
const nextMorning = new Date("2026-10-06T05:00:00Z");
const tellsWorldStory = (desk: string, over: Any = {}) => [{ ...defaultStories(desk)[0], headline: HEADLINES.world, ...over }];
const duplicateOfByDesk = async () => Object.fromEntries((await storedStories(database)).map((r) => [r.json.desk, r.json.validation.duplicateOf]));

beforeEach(() => resetNewsDesks(database));

describe("what a run reports", () => {
  test("one desk failing does not stop the others, and the desks come back in editor order", async () => {
    process.env.NEWS_DESKS = "talk,world,beat";
    stub.modelFailure = (call) => (call.desk === "world" && call.kind === "final" ? new Error("boom") : null);
    const outcome = await run();

    expect(outcome.desks.map((d) => [d.desk, d.status])).toEqual([["world", "failed"], ["beat", "ran"], ["talk", "ran"]]);
    expect(outcome.failures).toEqual([{ source: "news:world", error: "boom" }]);
    expect(outcome.desks[0].searchCalls).toBe(6);
    expect(outcome.searchCalls).toBe(6 + 6 + 3);
    expect((await storedDeliveries(database)).map((d) => d.source_name)).toEqual(["news:beat", "news:talk"]);
  });

  test("the home desk without a configured country is reported as a failure and the rest still run", async () => {
    process.env.NEWS_DESKS = "world,home";
    const outcome = await run();
    expect(outcome.home).toBeNull();
    expect(outcome.desks.map((d) => [d.desk, d.status])).toEqual([["world", "ran"], ["home", "unconfigured"]]);
    expect(outcome.failures).toEqual([{ source: "news:home", error: expect.stringContaining("NEWS_HOME_COUNTRY") }]);
    expect(outcome.desks[1]).toMatchObject({ stories: 0, searchCalls: 0 });
  });

  test("with every desk off nothing runs and nothing is loaded", async () => {
    process.env.NEWS_DESKS = "off";
    const outcome = await run();
    expect(outcome).toMatchObject({ window: null, desks: [], failures: [], searchCalls: 0 });
    expect(modelCalls).toHaveLength(0);
    expect(prompts).toEqual([]);
  });
});

describe("what each desk is shown", () => {
  test("the world desk sees nothing about the reader; each other desk only what its mandate needs", async () => {
    process.env.NEWS_DESKS = "world,home,beat,field,talk,serendipity";
    process.env.NEWS_HOME_COUNTRY = "CH";
    process.env.NEWS_HOME_CITY = "Zurich";
    process.env.NEWS_ALSO_COUNTRIES = "DE";
    await database.sql`insert into notes (scope, content, created_at) values ('intel', 'Quantum computing', now() - interval '2 minutes'), ('intel', 'Sailing', now() - interval '1 minute')`;
    await run();

    const payload = (desk: string) => modelCalls.find((c) => c.desk === desk && c.kind === "queries")!.input.desk_input;
    expect(Object.keys(payload("world")).sort()).toEqual(["already_reported", "window"]);
    expect(payload("home").home).toEqual({ city: "Zurich", region: null, country: "Switzerland", also_countries: ["Germany"] });
    expect(payload("beat")).toMatchObject({ interests: "Interest: sailing", priorities: ["Quantum computing", "Sailing"] });
    expect(payload("field")).toMatchObject({ priorities: ["Quantum computing", "Sailing"], beat_desk: true });
    expect(payload("talk")).toMatchObject({ home: { country: "Switzerland" }, reader_notes: ["Quantum computing", "Sailing"] });
    expect(payload("serendipity")).toMatchObject({ avoid: ["Quantum computing", "Sailing"] });
    expect(JSON.stringify([payload("world"), payload("home"), payload("talk"), payload("serendipity")])).not.toContain("sailing");
    expect(prompts.sort()).toEqual(["news_beat", "news_field", "news_home", "news_serendipity", "news_talk", "news_world"]);
  });

  test("the context document is only loaded when the beat or fields desk has to run", async () => {
    process.env.NEWS_DESKS = "world,talk";
    await run();
    expect(contextLoads).toHaveLength(0);

    process.env.NEWS_DESKS = "field";
    await run("2026-10-06", nextMorning);
    expect(contextLoads).toHaveLength(1);
    expect(modelCalls.find((c) => c.desk === "field")!.input.desk_input.beat_desk).toBe(false);
  });

  test("expired and deleted intel notes are not priorities", async () => {
    process.env.NEWS_DESKS = "beat";
    await database.sql`insert into notes (scope, content, expires_at) values ('intel', 'Old goal', '2026-10-01')`;
    await database.sql`insert into notes (scope, content, deleted_at) values ('intel', 'Gone goal', now())`;
    await database.sql`insert into notes (scope, content) values ('personal', 'Not an intel note'), ('intel', 'Live goal')`;
    await run();
    expect(modelCalls.find((c) => c.desk === "beat")!.input.desk_input.priorities).toEqual(["Live goal"]);
  });
});

describe("what is stored", () => {
  test("one delivery per desk, with every story stored whatever the checks say", async () => {
    process.env.NEWS_DESKS = "world,talk";
    stub.stories = (desk) => [
      defaultStories(desk)[0],
      { ...defaultStories(desk)[0], headline: `${HEADLINES[desk]} but old`, entities: ["other"], happened_at: "2026-09-01T00:00:00Z" },
    ];
    const outcome = await run();

    expect(outcome.desks.map((d) => [d.desk, d.stories])).toEqual([["world", 2], ["talk", 2]]);
    const stored = await storedStories(database);
    expect(stored).toHaveLength(4);
    expect(stored.filter((r) => r.json.validation.inWindow === false)).toHaveLength(2);
    expect((await storedDeliveries(database)).map((d) => d.message_id)).toEqual(["news:2026-10-05:talk", "news:2026-10-05:world"]);
    expect(outcome.window).toEqual({ start: "2026-10-04T05:00:00.000Z", end: "2026-10-05T05:00:00.000Z" });
  });

  test("a story another desk already told today is marked as the duplicate", async () => {
    process.env.NEWS_DESKS = "world,talk";
    stub.stories = (desk) => tellsWorldStory(desk);
    await run();

    const byDesk = await duplicateOfByDesk();
    expect(byDesk.world).toBeNull();
    expect(byDesk.talk).toEqual({ desk: "world", headline: HEADLINES.world });
  });

  test("a story the reader already saw on an earlier day is flagged, unless the desk calls it an update", async () => {
    await run();
    await database.sql`update extractions set included_in_report = true`;

    await run("2026-10-06", nextMorning);
    const again = (await storedStories(database)).filter((r) => r.run_date === "2026-10-06");
    expect(again[0].json.validation.alreadyReported).toEqual({ date: "2026-10-05", headline: HEADLINES.world });
    expect(modelCalls.at(-1)!.input.desk_input.already_reported).toEqual([{ date: "2026-10-05", headline: HEADLINES.world }]);

    await database.sql`delete from extractions where run_date = '2026-10-06'`;
    await database.sql`delete from raw_items where run_date = '2026-10-06'`;
    stub.stories = (desk) => [{ ...defaultStories(desk)[0], status: "update" }];
    await run("2026-10-06", nextMorning);
    const updated = (await storedStories(database)).filter((r) => r.run_date === "2026-10-06");
    expect(updated[0].json.validation.alreadyReported).toBeNull();
  });

  test("a dry run researches and checks but stores nothing, and previews the verdicts", async () => {
    stub.stories = (desk) => [{ ...defaultStories(desk)[0], sources: [{ id: "s99", publisher: "Nobody" }] }];
    const outcome = await run(DAY, NOW, { dryRun: true });

    expect(await storedDeliveries(database)).toEqual([]);
    expect(outcome.desks[0]).toMatchObject({ status: "ran", stories: 1 });
    expect(outcome.preview).toHaveLength(1);
    expect(outcome.preview![0]).toMatchObject({ desk: "world", story: { headline: HEADLINES.world }, validation: { verified: false } });
  });
});

describe("a second run on the same date", () => {
  test("reuses the desks already stored and pays only for the one that failed", async () => {
    process.env.NEWS_DESKS = "world,beat,talk";
    stub.modelFailure = (call) => (call.desk === "beat" && call.kind === "final" ? new Error("boom") : null);
    const first = await run();
    expect(first.desks.map((d) => [d.desk, d.status])).toEqual([["world", "ran"], ["beat", "failed"], ["talk", "ran"]]);

    stub.modelFailure = null;
    modelCalls.length = 0;
    const second = await run(DAY, new Date("2026-10-05T09:00:00Z"));

    expect(second.desks.map((d) => [d.desk, d.status, d.stories])).toEqual([["world", "reused", 1], ["beat", "ran", 1], ["talk", "reused", 1]]);
    expect(second.desks.filter((d) => d.status === "reused").every((d) => d.searchCalls === 0)).toBe(true);
    expect(new Set(modelCalls.map((c) => c.desk))).toEqual(new Set(["beat"]));
    expect(second.searchCalls).toBe(SEARCH_BUDGET.beat[0] + SEARCH_BUDGET.beat[1]);
    expect(second.window).toEqual(first.window);
    expect(second.failures).toEqual([]);
    expect(await storedDeliveries(database)).toHaveLength(3);
    expect(await storedStories(database)).toHaveLength(3);
  });

  test("a story from a reused desk is still checked against the new desk's stories", async () => {
    process.env.NEWS_DESKS = "world,talk";
    stub.modelFailure = (call) => (call.desk === "talk" && call.kind === "final" ? new Error("boom") : null);
    stub.stories = (desk) => tellsWorldStory(desk);
    await run();
    stub.modelFailure = null;
    await run();

    const byDesk = await duplicateOfByDesk();
    expect(byDesk.world).toBeNull();
    expect(byDesk.talk).toEqual({ desk: "world", headline: HEADLINES.world });
  });

  test("the next day's window starts where the last scan ended, within a day to three", async () => {
    await run();
    const nextDay = await run("2026-10-06", nextMorning);
    expect(nextDay.window).toEqual({ start: "2026-10-05T05:00:00.000Z", end: "2026-10-06T05:00:00.000Z" });

    const afterGap = await run("2026-10-12", new Date("2026-10-12T05:00:00Z"));
    expect(afterGap.window).toEqual({ start: "2026-10-09T05:00:00.000Z", end: "2026-10-12T05:00:00.000Z" });
  });
});
