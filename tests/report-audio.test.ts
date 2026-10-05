import { describe, expect, test } from "bun:test";
import { buildChapters, chunkText, estimateDurationMs, mp3DurationMs, speechText } from "../src/audio/chapters";
import type { ReportJson } from "../src/pipeline/report-json";

const report: ReportJson = {
  version: 2,
  date: "2026-10-02",
  personal: [
    { urgency: "critical", entries: [{ md: "- **Driving lesson today, 12:00.** Review the rules. <!--refs:abc-->", refIds: ["abc"] }] },
    { urgency: "high", entries: [] },
  ],
  news: [{ group: "Top stories", entries: [{ md: "A [parliament vote](https://example.com/a) passed, see https://example.com/b.", refIds: [] }] }],
  intel: [{ domain: "AI", entries: [{ md: "Model release.", refIds: [] }, { md: "   ", refIds: [] }] }],
  alsoNoted: [],
};

describe("speechText", () => {
  test("drops links, urls, refs comments and emphasis but keeps the words", () => {
    const out = speechText("**Bold** and [a link](https://example.com/x) <!--refs:1--> https://example.com/y `code`");
    expect(out).toBe("Bold and a link code.");
  });

  test("drops the trailing source links with their publisher names", () => {
    const md = "- **Vote passes.** The [parliament](https://example.com/a) agreed. [Reuters](https://example.com/r) · [BBC](https://example.com/b) <!--refs:1,2-->";
    expect(speechText(md)).toBe("Vote passes. The parliament agreed.");
    expect(speechText("Fact stated. ([Reuters](https://example.com/r))")).toBe("Fact stated.");
  });

  test("turns list items and headings into sentences", () => {
    expect(speechText("## Heading\n- one\n- two.\n1. three")).toBe("Heading.\none.\ntwo.\nthree.");
  });

  test("keeps underscores inside words", () => {
    expect(speechText("the snake_case_name stays")).toBe("the snake_case_name stays.");
  });

  test("table rows read as comma separated cells, rules vanish", () => {
    expect(speechText("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a, b.\n1, 2.");
  });
});

describe("buildChapters", () => {
  const chapters = buildChapters(report);

  test("one chapter per non-empty group, in page order", () => {
    expect(chapters.map((c) => `${c.section}/${c.title}`)).toEqual([
      "Personal Action Center/Critical",
      "News/Top stories",
      "Intelligence Briefing/AI",
    ]);
    expect(chapters.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  test("the first chapter opens with the date and section; later ones announce only a new section", () => {
    expect(chapters[0].text.split("\n").slice(0, 3)).toEqual(["Briefing for Friday 2 October.", "Personal Action Center.", "Critical."]);
    expect(chapters[1].text.startsWith("News.\nTop stories.\n")).toBe(true);
  });

  test("nothing a listener should not hear reaches the text", () => {
    for (const chapter of chapters) {
      expect(chapter.text).not.toMatch(/https?:|<!--|\*\*|\]\(/);
    }
    expect(chapters[1].text).toContain("A parliament vote passed, see.");
  });

  test("keys depend on the spoken text only", () => {
    expect(new Set(chapters.map((c) => c.key)).size).toBe(3);
    expect(buildChapters(report).map((c) => c.key)).toEqual(chapters.map((c) => c.key));
    const edited = structuredClone(report);
    edited.intel[0].entries[0].md = "Another release.";
    expect(buildChapters(edited)[2].key).not.toBe(chapters[2].key);
  });

  test("a report with no entries has no chapters", () => {
    expect(buildChapters({ ...report, personal: [], news: [], intel: [], alsoNoted: [] })).toEqual([]);
  });
});

describe("chunkText", () => {
  test("short text is one chunk", () => {
    expect(chunkText("a\nb", 100)).toEqual(["a\nb"]);
  });

  test("splits between lines first", () => {
    expect(chunkText("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  test("splits an over-long line at a sentence and loses no words", () => {
    const line = "One two three. Four five six. Seven eight nine. Ten eleven twelve.";
    const chunks = chunkText(line, 32);
    expect(chunks.every((c) => c.length <= 32)).toBe(true);
    expect(chunks.join(" ").split(/\s+/)).toEqual(line.split(/\s+/));
  });
});

describe("mp3DurationMs", () => {
  /** MPEG-2 layer 3, 128 kbit/s, 24 kHz: 576 samples and 384 bytes a frame, 24 ms each. */
  function frames(count: number): Uint8Array {
    const out = new Uint8Array(count * 384);
    for (let i = 0; i < count; i++) out.set([0xff, 0xf3, 0xc4, 0x00], i * 384);
    return out;
  }

  test("counts frames", () => {
    expect(mp3DurationMs(frames(100))).toBe(2400);
  });

  test("skips an ID3 tag", () => {
    const tag = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]);
    const audio = new Uint8Array(tag.length + 384 * 50);
    audio.set(tag);
    audio.set(frames(50), tag.length);
    expect(mp3DurationMs(audio)).toBe(1200);
  });

  test("falls back to the 128 kbit/s byte count for something that is not mp3", () => {
    expect(mp3DurationMs(new Uint8Array(16_000))).toBe(1000);
  });
});

test("estimateDurationMs scales with length", () => {
  expect(estimateDurationMs("x".repeat(140))).toBe(10_000);
});
