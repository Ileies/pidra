import { describe, expect, test } from "bun:test";
import {
  articleKey, cleanText, cleanUrl, findAlreadyReported, isAbroad, looksLikeArticle, markDuplicates, sameStory,
  resolveStorySources, tidyStory, toExtraction, verifySources, withinWindow,
  type Candidate, type DeskStory,
} from "../../src/news/validate";
import { clean, story, WINDOW } from "../fixtures/news";

/** The checks that stand between a model with a search engine and the report. */

describe("cleaning", () => {
  test("the tracking parameter the model adds is removed, the rest of the query kept", () => {
    expect(cleanUrl("https://news.example.com/a?id=7&utm_source=openai")).toBe("https://news.example.com/a?id=7");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("not a url")).toBeNull();
  });

  test("an article is its host and path", () => {
    expect(articleKey("https://www.news.example.com/a/?utm_source=openai")).toBe("news.example.com/a");
  });

  test("citations are stripped out of prose", () => {
    // The shape the first probe returned inside a summary.
    expect(cleanText("Talks ended without a deal. ([example.com](https://example.com/x?utm_source=openai))"))
      .toBe("Talks ended without a deal.");
    expect(cleanText("Reported by [the wire](https://example.com/y) today")).toBe("Reported by the wire today");
  });

  test("a front page or a section page is not an article", () => {
    // Both were cited as sources on the second probe.
    expect(looksLikeArticle("https://www.swissinfo.ch/ger/")).toBe(false);
    expect(looksLikeArticle("https://www.arabnews.com/middle-east")).toBe(false);
    expect(looksLikeArticle("https://www.example.com/news/world")).toBe(false);

    expect(looksLikeArticle("https://www.example.com/news/schweiz/stadt-budget-165562028")).toBe(true);
    expect(looksLikeArticle("https://apnews.com/article/2c7f54f07e755f506d9db9b91df282bd")).toBe(true);
    expect(looksLikeArticle("https://www.example.com/live-updates/summit-state-visit-dinner-tariffs/")).toBe(true);
    expect(looksLikeArticle("https://example.com/?id=42")).toBe(true);
  });

  test("tidyStory drops sources without a usable URL and caps them at three", () => {
    const tidy = tidyStory(story({
      sources: [
        { publisher: "A", title: "a", url: "https://a.example.com/1?utm_source=openai" },
        { publisher: "B", title: "b", url: "ftp://b.example.com/2" },
        { publisher: "C", title: "c", url: "https://c.example.com/3" },
        { publisher: "D", title: "d", url: "https://d.example.com/4" },
        { publisher: "E", title: "e", url: "https://e.example.com/5" },
      ],
    }));
    expect(tidy.sources.map((s) => s.url)).toEqual([
      "https://a.example.com/1",
      "https://c.example.com/3",
      "https://d.example.com/4",
    ]);
  });
});

describe("checks", () => {
  test("source ids resolve to exact Brave URLs even if a model supplies an unknown id", () => {
    const exact = "https://news.example.com/politics/budget-vote-passes";
    const cited = { ...story(), sources: [{ id: "s1", publisher: "Example Wire" }, { id: "s99", publisher: "Fake" }] };
    const result = resolveStorySources(cited, new Map([["s1", { title: "Budget passes", url: exact, description: "" }]]));
    expect(result.sources).toEqual([{ publisher: "Example Wire", title: "Budget passes", url: exact }]);
  });

  test("unverified source URLs never reach the report's links", () => {
    const unverified = "https://invented.example.com/fake-article";
    const proposed = story({ sources: [...story().sources, { publisher: "Invented", title: "Fake", url: unverified }] });
    const validation = verifySources(proposed, [story().sources[0].url]);
    const extraction = toExtraction("world", proposed, { ...clean, ...validation });
    expect(extraction.sources.map((source) => source.url)).toEqual([story().sources[0].url]);
    expect(extraction.validation.unverifiedUrls).toEqual([unverified]);
  });

  test("a story is verified when one of its sources is a URL the search returned", () => {
    const consulted = ["https://www.news.example.com/politics/budget-vote-passes/", "https://other.example.com/x"];
    expect(verifySources(story(), consulted)).toEqual({ verified: true, unverifiedUrls: [] });
  });

  test("a story whose every source is unknown to the search is not", () => {
    const result = verifySources(story(), ["https://other.example.com/x"]);
    expect(result.verified).toBe(false);
    expect(result.unverifiedUrls).toEqual(["https://news.example.com/politics/budget-vote-passes"]);
  });

  test("a search that reported no URLs cannot be judged either way", () => {
    expect(verifySources(story(), null).verified).toBeNull();
  });

  test("a desk that never searched verifies nothing: that is its memory, not today's news", () => {
    expect(verifySources(story(), []).verified).toBe(false);
  });

  test("a story without sources is never verified", () => {
    expect(verifySources(story({ sources: [] }), null).verified).toBe(false);
    expect(verifySources(story({ sources: [] }), ["https://news.example.com/x"]).verified).toBe(false);
  });

  test("stale developments are outside the window; later ones are announcements, not stale", () => {
    expect(withinWindow("2026-09-24T12:00:00Z", WINDOW)).toBe(true);
    // Within the 12-hour tolerance before the window.
    expect(withinWindow("2026-09-23T20:00:00Z", WINDOW)).toBe(true);
    expect(withinWindow("2026-09-22T12:00:00Z", WINDOW)).toBe(false);
    expect(withinWindow("2026-09-30", WINDOW)).toBe(true);
    expect(withinWindow("yesterday", WINDOW)).toBeNull();
  });

  test("a bare date counts as the whole day", () => {
    expect(withinWindow("2026-09-23", WINDOW)).toBe(true);
    expect(withinWindow("2026-09-22", WINDOW)).toBe(false);
  });

  test("the same article or nearly the same headline is the same story", () => {
    const a = { headline: "Storm floods the old town", urls: ["https://x.example.com/storm"] };
    expect(sameStory(a, { headline: "Something else entirely", urls: ["https://www.x.example.com/storm/"] })).toBe(true);
    expect(sameStory(
      { headline: "Central bank holds its key rate at zero percent", urls: [] },
      { headline: "Central bank holds key rate at zero percent", urls: [] },
    )).toBe(true);
    expect(sameStory(
      { headline: "Central bank holds its key rate at zero percent", urls: [] },
      { headline: "Diesel prices climb to a record high", urls: [] },
    )).toBe(false);
  });

  test("numbers tell two match reports apart", () => {
    expect(sameStory(
      { headline: "Home side beats visitors 6-0 in league match", urls: [] },
      { headline: "Home side beats visitors 2-1 in league match", urls: [] },
    )).toBe(false);
  });

  test("a death toll that rose is new, not a repeat of yesterday's figure", () => {
    const reported = [{ date: "2026-09-24", headline: "Earthquake in the north kills 50 people", urls: [] }];
    expect(findAlreadyReported(story({ headline: "Earthquake in the north kills 120 people" }), reported)).toBeNull();
  });

  test("an already-reported story is held back unless the desk calls it an update", () => {
    const reported = [{ date: "2026-09-24", headline: story().headline, urls: [] }];
    expect(findAlreadyReported(story(), reported)).toEqual({ date: "2026-09-24", headline: story().headline });
    expect(findAlreadyReported(story({ status: "update" }), reported)).toBeNull();
  });
});

describe("markDuplicates", () => {
  const candidate = (desk: Candidate["desk"], deskOrder: number, s: DeskStory, stored = false): Candidate => ({
    desk, deskOrder, story: s, validation: { ...clean }, stored,
  });

  test("the more significant copy is kept", () => {
    const world = candidate("world", 0, story({ significance: 3 }));
    const home = candidate("home", 1, story({ significance: 5 }));
    markDuplicates([world, home]);
    expect(home.validation.duplicateOf).toBeNull();
    expect(world.validation.duplicateOf).toEqual({ desk: "home", headline: story().headline });
  });

  test("on a tie, the desk that comes first in the section wins", () => {
    const world = candidate("world", 0, story());
    const talk = candidate("talk", 3, story());
    markDuplicates([talk, world]);
    expect(world.validation.duplicateOf).toBeNull();
    expect(talk.validation.duplicateOf?.desk).toBe("world");
  });

  test("a stored story is never re-judged, so the fresh copy is the duplicate", () => {
    const stored = candidate("talk", 3, story({ significance: 3 }), true);
    const fresh = candidate("world", 0, story({ significance: 5 }));
    markDuplicates([fresh, stored]);
    expect(stored.validation.duplicateOf).toBeNull();
    expect(fresh.validation.duplicateOf?.desk).toBe("talk");
  });

  test("a copy that would not pass cannot swallow one that would", () => {
    // A home story about a country followed from abroad needs a 4; at 3 it wins the tie on desk
    // order, but must not take the talk desk's passable copy down with it.
    const abroad = candidate("home", 1, story({ significance: 3 }));
    abroad.validation.abroad = true;
    const talk = candidate("talk", 3, story({ significance: 3 }));
    const passes = (c: Candidate) => !(c.validation.abroad && c.story.significance < 4);
    markDuplicates([abroad, talk], passes);
    expect(talk.validation.duplicateOf).toBeNull();
  });

  test("a held-back story cannot make another one a duplicate", () => {
    const stale = candidate("world", 0, story());
    stale.validation.alreadyReported = { date: "2026-09-24", headline: story().headline };
    const update = candidate("home", 1, story({ status: "update" }));
    markDuplicates([stale, update]);
    expect(update.validation.duplicateOf).toBeNull();
  });
});

describe("isAbroad", () => {
  const home = { city: "Lyon", countryName: "France", also: [{ code: "BE", name: "Belgium" }] };

  test("a story in an also-country is abroad", () => {
    expect(isAbroad("Belgium", home)).toBe(true);
  });

  test("home wins: the home country, the city, or a story about both", () => {
    expect(isAbroad("France", home)).toBe(false);
    expect(isAbroad("Lyon", home)).toBe(false);
    expect(isAbroad("France and Belgium", home)).toBe(false);
  });

  test("nothing is abroad without also-countries", () => {
    expect(isAbroad("Belgium", { ...home, also: [] })).toBe(false);
    expect(isAbroad("Belgium", null)).toBe(false);
  });
});
