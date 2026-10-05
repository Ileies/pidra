import { describe, expect, test } from "bun:test";
import { NEWS_CAPS } from "../../src/news/config";
import { editorStories, enforceNewsCaps, finishNewsSection, foldSingleStoryGroups, renderNewsFallback, sourceLinks, type NewsItem } from "../../src/news/format";
import { item } from "../fixtures/news";

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
