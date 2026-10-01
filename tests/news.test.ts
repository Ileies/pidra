import { describe, expect, test } from "bun:test";
import { enabledDesks, homeConfig, NEWS_CAPS, newsWindow, SEARCH_BUDGET } from "../src/news/config";
import {
  articleKey, cleanText, cleanUrl, findAlreadyReported, isAbroad, looksLikeArticle, markDuplicates, sameStory,
  resolveStorySources, tidyStory, toExtraction, verifySources, withinWindow,
  type Candidate, type DeskStory, type NewsExtraction, type NewsValidation,
} from "../src/news/validate";
import { editorStories, enforceNewsCaps, finishNewsSection, foldSingleStoryGroups, renderNewsFallback, sourceLinks, type NewsItem } from "../src/news/format";
import { decideGate } from "../src/pipeline/gate";

/**
 * The news desks' deterministic half: what they are configured to cover, which window they
 * search, and the checks that stand between a model with a search engine and the report.
 */

const story = (overrides: Partial<DeskStory> = {}): DeskStory => ({
  headline: "Parliament approves the new budget after a late-night vote",
  summary: "The lower house passed the budget 312 to 290.",
  context: "",
  significance: 4,
  status: "new",
  confidence: "confirmed",
  region: "global",
  topic: "politics",
  happened_at: "2026-09-25T01:00:00Z",
  entities: ["Parliament"],
  sources: [{ publisher: "Example Wire", title: "Budget passes", url: "https://news.example.com/politics/budget-vote-passes" }],
  ...overrides,
});

const clean: NewsValidation = { verified: true, unverifiedUrls: [], inWindow: true, duplicateOf: null, alreadyReported: null };

const WINDOW = { start: "2026-09-24T04:30:00.000Z", end: "2026-09-25T04:30:00.000Z" };

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

const item = (id: string, desk: NewsExtraction["desk"], overrides: Partial<NewsExtraction> = {}): NewsItem => ({
  id,
  story: {
    desk,
    headline: `Headline ${id}`,
    key_claim: `Summary ${id}.`,
    context: "",
    significance: 4,
    status: "new",
    confidence: "confirmed",
    region: "global",
    topic: "politics",
    happened_at: "2026-09-25",
    entities: [],
    sources: [{ publisher: `Pub ${id}`, title: "t", url: `https://${id}.example.com/story` }],
    validation: clean,
    ...overrides,
  },
});

describe("the News section", () => {
  test("stories get short ids in desk order, most significant first", () => {
    const { stories, refs } = editorStories([
      item("u-talk", "talk"),
      item("u-world-3", "world", { significance: 3 }),
      item("u-world-5", "world", { significance: 5 }),
    ]);
    expect(stories.map((s) => s.id)).toEqual(["n1", "n2", "n3"]);
    expect(refs.get("n1")!.id).toBe("u-world-5");
    expect(refs.get("n3")!.id).toBe("u-talk");
  });

  test("short ids become extraction ids, and the checked sources are linked in", () => {
    const refs = new Map([["n1", item("u1", "world")], ["n2", item("u2", "world")]]);
    const out = finishNewsSection("## News\n\n### Top stories\n\n- **A.** Facts. <!--refs:n1,n2-->", refs);
    expect(out).toContain("[Pub u1](https://u1.example.com/story) · [Pub u2](https://u2.example.com/story) <!--refs:u1,u2-->");
  });

  test("links attached to a comment written flush against the text get their own space", () => {
    const refs = new Map([["n1", item("u1", "world")]]);
    const out = finishNewsSection("## News\n\n- **A.** Facts.<!--refs:n1-->", refs);
    expect(out).toContain("Facts. [Pub u1](https://u1.example.com/story) <!--refs:u1-->");
  });

  test("an id that maps to nothing is dropped, like a dead ref", () => {
    const refs = new Map([["n1", item("u1", "world")]]);
    const out = finishNewsSection("## News\n\n- **A.** Facts. <!--refs:n9-->", refs);
    expect(out).not.toContain("refs:");
  });

  test("a link the editor wrote itself is removed", () => {
    const refs = new Map([["n1", item("u1", "world")]]);
    const out = finishNewsSection("## News\n\n- **A.** See [the wire](https://invented.example.com). <!--refs:n1-->", refs);
    expect(out).not.toContain("invented.example.com");
    expect(out).toContain("See the wire.");
  });

  test("the heading the parser keys on is always there", () => {
    const refs = new Map([["n1", item("u1", "world")]]);
    expect(finishNewsSection("### Top stories\n\n- x <!--refs:n1-->", refs).startsWith("## News\n\n")).toBe(true);
    expect(finishNewsSection("# News - 25 September\n\n- x <!--refs:n1-->", refs).startsWith("## News\n")).toBe(true);
  });

  test("one link per publisher, at most three", () => {
    const shared = item("u1", "world", {
      sources: [
        { publisher: "Wire", title: "a", url: "https://wire.example.com/a" },
        { publisher: "wire", title: "b", url: "https://wire.example.com/b" },
      ],
    });
    expect(sourceLinks([shared])).toBe("[Wire](https://wire.example.com/a)");
  });

  test("the fallback keeps the editor's groups and caps", () => {
    const out = renderNewsFallback(
      [
        item("w", "world"),
        item("h", "home"),
        item("h2", "home"),
        item("h5", "home", { significance: 5 }),
        item("s", "serendipity", { status: "update" }),
        item("s2", "serendipity"),
      ],
      { city: "Lyon", region: null, country: "FR", countryName: "France", also: [], label: "Lyon & France" },
    );
    expect(out.startsWith("## News\n\n### Top stories")).toBe(true);
    // A significance-5 home story leads, alongside the world desk.
    expect(out.indexOf("Headline h5")).toBeLessThan(out.indexOf("### Lyon & France"));
    expect(out).toContain("- **Something different: UPDATE: Headline s** Summary s.");
    expect(out).not.toContain("Headline s2");
    expect(renderNewsFallback([], null)).toBe("");
  });

  test("a 5 on the something-different desk is a curiosity, not a top story", () => {
    const out = renderNewsFallback(
      [item("w", "world"), item("odd", "serendipity", { significance: 5 }), item("odd2", "serendipity")],
      null,
    );
    expect(out.indexOf("Headline odd")).toBeGreaterThan(out.indexOf("### Something different"));
  });

  test("a lone single-story group joins the group above it, labelled", () => {
    const out = foldSingleStoryGroups(
      "## News\n\n### Top stories\n\n- **A.** Facts. <!--refs:n1-->\n- **B.** Facts. <!--refs:n2-->\n\n" +
        "### Talk of the day\n\n- plain bullet <!--refs:n4-->\n\n" +
        "### Something different\n\n- **D.** <!--refs:n5-->\n- **E.** <!--refs:n6-->",
    );
    expect(out).not.toContain("### Talk of the day");
    expect(out).toContain("- **B.** Facts. <!--refs:n2-->\n- **Talk of the day:** plain bullet <!--refs:n4-->\n\n### Something different");
    expect(out).toContain("### Something different\n\n- **D.**");
  });

  test("several single-story groups in a row share one In brief heading", () => {
    const out = foldSingleStoryGroups(
      "## News\n\n### Top stories\n\n- **A.** <!--refs:n1-->\n- **B.** <!--refs:n2-->\n\n" +
        "### AI\n\n- **C.** Facts. <!--refs:n3-->\n\n### Markets\n\n- **D.** Facts. <!--refs:n4-->",
    );
    expect(out).not.toContain("### AI");
    expect(out).toContain("### In brief\n\n- **AI: C.** Facts. <!--refs:n3-->\n- **Markets: D.** Facts. <!--refs:n4-->");
  });

  test("the first group keeps its heading even with a single story", () => {
    const md = "## News\n\n### Top stories\n\n- **A.** Facts. <!--refs:n1-->";
    expect(foldSingleStoryGroups(md)).toBe(md);
  });

  describe("caps on the editor's own output", () => {
    const lyon = { city: "Lyon", region: null, country: "FR", countryName: "France", also: [{ code: "CH", name: "Switzerland" }], label: "Lyon & France" };
    const bullets = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `- **${prefix}${i + 1}.** Facts. <!--refs:${prefix}${i + 1}-->`).join("\n");
    const refsFor = (prefix: string, n: number, significance = (i: number) => 3) =>
      Array.from({ length: n }, (_, i): [string, NewsItem] => [`${prefix}${i + 1}`, item(`${prefix}${i + 1}`, "world", { significance: significance(i) })]);

    test("every group is cut to its cap, and the section total stays bounded", () => {
      const refs = new Map([...refsFor("t", 12), ...refsFor("h", 9), ...refsFor("c", 5), ...refsFor("a", 8), ...refsFor("b", 8), ...refsFor("k", 7), ...refsFor("s", 4)]);
      const md = [
        "## News",
        `### Top stories\n\n${bullets(12, "t")}`,
        `### Lyon & France\n\n${bullets(9, "h")}`,
        `### Switzerland\n\n${bullets(5, "c")}`,
        `### AI\n\n${bullets(8, "a")}`,
        `### Markets\n\n${bullets(8, "b")}`,
        `### Talk of the day\n\n${bullets(7, "k")}`,
        `### Something different\n\n${bullets(4, "s")}`,
      ].join("\n\n");
      const out = enforceNewsCaps(md, refs, lyon);
      const count = (prefix: string) => (out.match(new RegExp(`<!--refs:${prefix}\\d+-->`, "g")) ?? []).length;
      expect(count("t")).toBe(NEWS_CAPS.top);
      expect(count("h")).toBe(NEWS_CAPS.home);
      expect(count("c")).toBe(NEWS_CAPS.alsoCountry);
      expect(count("a") + count("b")).toBe(NEWS_CAPS.fields);
      expect(count("a")).toBeLessThanOrEqual(NEWS_CAPS.perField);
      expect(count("k")).toBe(NEWS_CAPS.talk);
      expect(count("s")).toBe(NEWS_CAPS.serendipity);
    });

    test("the least significant bullets go first, ties keep the earlier one", () => {
      const refs = new Map(refsFor("t", 8, (i) => (i === 7 ? 5 : 3)));
      const out = enforceNewsCaps(`## News\n\n### Top stories\n\n${bullets(8, "t")}`, refs, null);
      expect(out).toContain("refs:t8"); // significance 5 survives although written last
      expect(out).toContain("refs:t1");
      expect(out).not.toContain("refs:t7");
      expect(out).not.toContain("refs:t6");
    });

    test("a bullet merging several stories counts once and ranks by its best story", () => {
      const refs = new Map(refsFor("t", 8, (i) => (i === 7 ? 5 : 2)));
      const md = `## News\n\n### Top stories\n\n${bullets(6, "t")}\n- **Merged.** Facts. <!--refs:t7,t8-->`;
      const out = enforceNewsCaps(md, refs, null);
      expect(out).toContain("refs:t7,t8");
      expect(out).not.toContain("refs:t6");
    });

    test("a wrapped bullet is removed whole", () => {
      const refs = new Map([...refsFor("t", 6, () => 4), ["w1", item("w1", "world", { significance: 1 })] as [string, NewsItem]]);
      const md = `## News\n\n### Top stories\n\n${bullets(6, "t")}\n- **Gone.** first line\n  second line <!--refs:w1-->`;
      const out = enforceNewsCaps(md, refs, null);
      expect(out).not.toContain("first line");
      expect(out).not.toContain("second line");
      expect(out).toContain("refs:t6");
    });

    test("a heading emptied by the field total goes with its bullets", () => {
      const refs = new Map([...refsFor("a", 4, () => 5), ...refsFor("b", 4, () => 5), ...refsFor("c", 2, () => 1)]);
      const md = `## News\n\n### AI\n\n${bullets(4, "a")}\n\n### Markets\n\n${bullets(4, "b")}\n\n### Chess\n\n${bullets(2, "c")}`;
      const out = enforceNewsCaps(md, refs, null);
      expect(out).not.toContain("### Chess");
      expect(out).not.toContain("refs:c");
      expect(out).toContain("### Markets");
      expect(out).not.toMatch(/\n{3,}/);
    });

    test("within the caps, the text is returned untouched", () => {
      const md = `## News\n\n### Top stories\n\n${bullets(3, "t")}`;
      expect(enforceNewsCaps(md, new Map(refsFor("t", 3)), null)).toBe(md);
    });

    test("finishNewsSection applies the caps on the normal path", () => {
      const refs = new Map(refsFor("t", 9));
      const out = finishNewsSection(`## News\n\n### Top stories\n\n${bullets(9, "t")}`, refs);
      expect(out.match(/<!--refs:/g)).toHaveLength(NEWS_CAPS.top);
    });
  });

  test("the beat and fields desks share one heading", () => {
    const out = renderNewsFallback([item("b", "beat"), item("f", "field")], null);
    expect(out.match(/### Your fields/g)).toHaveLength(1);
    expect(out).toContain("Headline b");
    expect(out).toContain("Headline f");
  });
});

describe("the gate on news stories", () => {
  const gate = (validation: Partial<NewsValidation>, significance = 4) =>
    decideGate({
      sourceType: "web_news",
      aiFailed: false,
      extractedJson: { headline: "x", validation: { ...clean, ...validation } },
      relevanceScore: significance,
      trustScore: 1,
      sourceCount: 1,
    });

  test("a checked story at the bar passes", () => {
    expect(gate({}, 3)).toMatchObject({ passed: true, reason: "passed" });
  });

  test("each check has its own reason, ahead of the score", () => {
    expect(gate({ verified: false }, 5).reason).toBe("unverified_source");
    expect(gate({ inWindow: false }, 5).reason).toBe("outside_window");
    expect(gate({ duplicateOf: { desk: "world", headline: "x" } }).reason).toBe("duplicate");
    expect(gate({ alreadyReported: { date: "2026-09-24", headline: "x" } }).reason).toBe("already_reported");
  });

  test("an unjudgeable check does not hold a story back", () => {
    expect(gate({ verified: null, inWindow: null }).passed).toBe(true);
  });

  test("below the bar is below the bar", () => {
    expect(gate({}, 2)).toMatchObject({ passed: false, reason: "below_threshold" });
  });

  test("a country followed from abroad needs a 4", () => {
    expect(gate({ abroad: true }, 3)).toMatchObject({ passed: false, reason: "below_threshold" });
    expect(gate({ abroad: true }, 3).detail.threshold).toBe(4);
    expect(gate({ abroad: true }, 4).passed).toBe(true);
  });
});

describe("the gate on newsletter items", () => {
  const gate = (substance: string | undefined, relevanceScore = 4) =>
    decideGate({
      sourceType: "newsletter",
      aiFailed: false,
      extractedJson: { headline: "x", key_claim: "y", ...(substance ? { substance } : {}) },
      relevanceScore,
      trustScore: 1,
      sourceCount: 1,
    });

  test("a teaser is held back whatever it scored", () => {
    expect(gate("teaser", 5)).toMatchObject({ passed: false, reason: "teaser_only" });
  });

  test("a fact or an argument is judged on its score, and so is an item extracted before the field existed", () => {
    expect(gate("fact").passed).toBe(true);
    expect(gate("argument").passed).toBe(true);
    expect(gate(undefined).passed).toBe(true);
    expect(gate("fact", 2).reason).toBe("below_threshold");
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
