import { describe, expect, test } from "bun:test";
import { enabledDesks, homeConfig, newsWindow, SEARCH_BUDGET } from "../../src/news/config";
import { WINDOW } from "../fixtures/news";

/** What the news desks are configured to cover, and which window they search. */

describe("configuration", () => {
  test("the scheduled desk and Section 1 budgets total 30 Brave calls", () => {
    const deskCalls = Object.values(SEARCH_BUDGET).reduce((sum, [first, followup]) => sum + first + followup, 0);
    expect(deskCalls + 3).toBe(30);
  });
  test("no home country means no home desk, and says so", () => {
    const plan = enabledDesks({});
    expect(plan.desks.map((d) => d.id)).toEqual(["world", "beat", "field", "talk", "serendipity"]);
    expect(plan.unconfigured.map((u) => u.desk.id)).toEqual(["home"]);
  });

  test("a configured home enables every desk", () => {
    const plan = enabledDesks({ NEWS_HOME_COUNTRY: "FR", NEWS_HOME_CITY: "Lyon" });
    expect(plan.desks.map((d) => d.id)).toEqual(["world", "home", "beat", "field", "talk", "serendipity"]);
    expect(plan.unconfigured).toEqual([]);
  });

  test("NEWS_DESKS picks a subset, and off turns the desk off entirely", () => {
    expect(enabledDesks({ NEWS_DESKS: "world,talk" }).desks.map((d) => d.id)).toEqual(["world", "talk"]);
    expect(enabledDesks({ NEWS_DESKS: "off" })).toEqual({ desks: [], unconfigured: [] });
  });

  test("the home label names the city and the country", () => {
    const home = homeConfig({ NEWS_HOME_COUNTRY: "fr", NEWS_HOME_CITY: "Lyon", NEWS_ALSO_COUNTRIES: "BE, xx, FR" })!;
    expect(home.country).toBe("FR");
    expect(home.label).toBe("Lyon & France");
    // The home country and anything that is not a two-letter code are dropped.
    expect(home.also).toEqual([{ code: "BE", name: "Belgium" }]);
  });

  test("an invalid country code is no home at all", () => {
    expect(homeConfig({ NEWS_HOME_COUNTRY: "France" })).toBeNull();
  });
});

describe("newsWindow", () => {
  const now = new Date("2026-09-25T04:30:00Z");

  test("a first run looks back one day", () => {
    expect(newsWindow(now, null)).toEqual(WINDOW);
  });

  test("after a missed day it reaches back to where the last scan ended", () => {
    const window = newsWindow(now, new Date("2026-09-23T04:30:00Z"));
    expect(window.start).toBe("2026-09-23T04:30:00.000Z");
  });

  test("never more than three days, never less than one", () => {
    expect(newsWindow(now, new Date("2026-09-01T00:00:00Z")).start).toBe("2026-09-22T04:30:00.000Z");
    expect(newsWindow(now, new Date("2026-09-25T02:00:00Z")).start).toBe("2026-09-24T04:30:00.000Z");
  });
});
