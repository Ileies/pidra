// src/news/judge.ts: the repeat judge's verdicts as a run records them. The model is stubbed
// (tests-db/fixtures/news-desks.ts); what is under test is which stories a verdict holds back, that a
// failed or invented verdict changes nothing, and what the judge is shown.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";
import { DAY, defaultStories, HEADLINES, judgeCalls, loadContext, NOW, resetNewsDesks, storedStories, stub, type Any } from "./fixtures/news-desks";

const database = await useTestDatabase();
const { runNewsDesk } = await import("../src/news/run");

const run = (date = DAY, now = NOW) => runNewsDesk(date, { now, loadContext });
const nextMorning = new Date("2026-10-06T05:00:00Z");
const verdicts = async (date: string) => Object.fromEntries((await storedStories(database)).filter((r) => r.run_date === date).map((r) => [r.json.desk, r.json.validation]));

/** Day one is told to the reader; the next morning's desk finds the same event in other words. */
async function toldYesterday() {
  await run();
  await database.sql`update extractions set included_in_report = true`;
  await database.sql`update raw_items set run_date = run_date`;
}
// Another outlet, so the cheap URL check cannot catch it: only the judge can say it is the same event.
const otherOutlet = (query: string): Any[] => ["a", "b", "c"].map((n) => ({ title: `Other ${n}`, url: `https://other.example.org/${query.replaceAll(" ", "-")}/${n}`, description: `About ${query}`, age: "1 hour ago" }));
const reworded = (desk: string, over: Any = {}) => [{ ...defaultStories(desk)[0], headline: "Lawmakers pass this year's state budget", happened_at: "2026-10-06T01:00:00Z", ...over }];

beforeEach(() => resetNewsDesks(database));

describe("the repeat judge", () => {
  test("holds back a re-worded story the reader was already told, and shows the judge what was told", async () => {
    await toldYesterday();
    stub.stories = (desk) => reworded(desk);
    stub.braveResults = otherOutlet;
    stub.judgement = () => ({ repeats: [{ id: "c1", told_id: "t1", adds_new_fact: false }], groups: [] });
    await run("2026-10-06", nextMorning);

    expect((await verdicts("2026-10-06")).world.alreadyReported).toEqual({ date: DAY, headline: HEADLINES.world });
    expect(judgeCalls.at(-1)).toMatchObject({
      candidates: [{ id: "c1", desk: "world", headline: "Lawmakers pass this year's state budget" }],
      told: [{ id: "t1", date: DAY, headline: HEADLINES.world }],
    });
  });

  test("keeps a story that adds a new fact to what the reader was told", async () => {
    await toldYesterday();
    stub.stories = (desk) => reworded(desk, { status: "update" });
    stub.braveResults = otherOutlet;
    stub.judgement = () => ({ repeats: [{ id: "c1", told_id: "t1", adds_new_fact: true }], groups: [] });
    await run("2026-10-06", nextMorning);

    expect((await verdicts("2026-10-06")).world.alreadyReported).toBeNull();
  });

  test("marks the lower-ranked copy of one event as the duplicate, whatever its wording", async () => {
    process.env.NEWS_DESKS = "world,talk";
    stub.stories = (desk) => [{ ...defaultStories(desk)[0], headline: `${desk} says the budget passed`, significance: desk === "talk" ? 5 : 3 }];
    stub.judgement = () => ({ repeats: [], groups: [{ ids: ["c1", "c2"] }] });
    await run();

    const byDesk = await verdicts(DAY);
    expect(byDesk.talk.duplicateOf).toBeNull();
    expect(byDesk.world.duplicateOf).toEqual({ desk: "talk", headline: "talk says the budget passed" });
  });

  test("ignores ids it was never given and a group of one", async () => {
    await toldYesterday();
    stub.stories = (desk) => reworded(desk);
    stub.braveResults = otherOutlet;
    stub.judgement = () => ({ repeats: [{ id: "c9", told_id: "t1", adds_new_fact: false }, { id: "c1", told_id: "t9", adds_new_fact: false }], groups: [{ ids: ["c1"] }, { ids: ["c1", "c7"] }] });
    await run("2026-10-06", nextMorning);

    expect(await verdicts("2026-10-06")).toMatchObject({ world: { alreadyReported: null, duplicateOf: null } });
  });

  test("a judge that fails leaves every story as the checks left it, and the run goes on", async () => {
    await toldYesterday();
    stub.stories = (desk) => reworded(desk);
    stub.braveResults = otherOutlet;
    stub.judgeFailure = new Error("boom");
    const outcome = await run("2026-10-06", nextMorning);

    expect(outcome.failures).toEqual([]);
    expect((await verdicts("2026-10-06")).world).toMatchObject({ alreadyReported: null, duplicateOf: null });
  });

  test("is not called on a first day with a single story: there is nothing to compare it with", async () => {
    await run();
    expect(judgeCalls).toHaveLength(0);
  });

  test("its tokens and call count are part of the outcome", async () => {
    await toldYesterday();
    stub.stories = (desk) => reworded(desk);
    stub.braveResults = otherOutlet;
    const before = await run("2026-10-06", nextMorning);
    // Two query rounds and the final answer, plus the judge call.
    expect(before.aiCalls).toBe(4);
    expect(before.tokensIn).toBe(3 * 100 + 50);
  });
});
