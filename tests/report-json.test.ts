import { describe, expect, test } from "bun:test";
import { parseReport } from "../src/pipeline/report-json";

/**
 * The parser is the contract between the synthesis prompts and the dashboard, so these tests are
 * really a description of the format the prompts promise. If a prompt changes shape, one of
 * these fails, which is the point of parsing in the pipeline rather than in the UI.
 */

const REPORT = `# Morning Briefing - 2026-09-11

---

## Personal Action Center

### Critical

- **Invoice due today:** Pay it before 18:00. <!--refs:aaa-->

### High priority

- **Account verification:** Upload the ID. <!--refs:bbb,ccc-->
  Continues on an indented line that belongs to the same item.
- **Second item:** Something else. <!--refs:ddd-->

### Normal

Nothing pressing. <!--refs:eee-->

### Mentions

- Nobody was mentioned.

---

## Intelligence Briefing

### AI and Security

- **A claim.** With a body. <!--refs:fff-->
- **Another claim.** <!--refs:ggg-->

### Energy

- UPDATE: the ongoing story moved. <!--refs:hhh-->

### Also noted

- One-liner. <!--refs:iii-->

<!--SYSTEM
{ "new_topics": [] }
-->`;

describe("parseReport", () => {
  const parsed = parseReport(REPORT, "2026-09-11")!;

  test("returns null when a section heading is missing", () => {
    expect(parseReport("## Intelligence Briefing\n\n### AI\n\n- Only one section.", "2026-09-11")).toBeNull();
    expect(parseReport("nothing structured here", "2026-09-11")).toBeNull();
  });

  test("groups Section 2 by urgency, in a fixed order", () => {
    expect(parsed.personal.map((group) => group.urgency)).toEqual(["critical", "high", "normal", "mentions"]);
  });

  test("groups Section 1 by domain, keeping Also noted separate", () => {
    expect(parsed.intel.map((group) => group.domain)).toEqual(["AI and Security", "Energy"]);
    expect(parsed.alsoNoted).toHaveLength(1);
  });

  test("splits a list into one entry per top-level bullet", () => {
    const high = parsed.personal.find((group) => group.urgency === "high")!;
    expect(high.entries).toHaveLength(2);
  });

  test("keeps an indented continuation line with the bullet that owns it", () => {
    const high = parsed.personal.find((group) => group.urgency === "high")!;
    expect(high.entries[0].md).toContain("Continues on an indented line");
  });

  test("pulls refs out of the markdown and off the prose", () => {
    const high = parsed.personal.find((group) => group.urgency === "high")!;
    expect(high.entries[0].refIds).toEqual(["bbb", "ccc"]);
    expect(high.entries[0].md).not.toContain("<!--refs");
  });

  test("treats a paragraph without a bullet as one entry", () => {
    const normal = parsed.personal.find((group) => group.urgency === "normal")!;
    expect(normal.entries).toHaveLength(1);
    expect(normal.entries[0].md).toBe("Nothing pressing.");
  });

  test("drops the horizontal rule Phase 6 joins the sections with", () => {
    const everything = [
      ...parsed.personal.flatMap((group) => group.entries),
      ...parsed.intel.flatMap((group) => group.entries),
      ...parsed.alsoNoted,
    ];
    expect(everything.some((entry) => /^-{3,}$/.test(entry.md))).toBe(false);
  });

  test("strips the SYSTEM block rather than parsing it as content", () => {
    const everything = [...parsed.intel.flatMap((group) => group.entries), ...parsed.alsoNoted];
    expect(everything.some((entry) => entry.md.includes("new_topics"))).toBe(false);
  });

  test("keeps Section 1 prose that sits before the first domain heading", () => {
    const lead = parseReport(
      "## Personal Action Center\n\n### Critical\n\n- x <!--refs:a-->\n\n## Intelligence Briefing\n\nA lead paragraph.\n\n### AI\n\n- y <!--refs:b-->",
      "2026-09-11",
    )!;
    expect(lead.intel[0].domain).toBe("Briefing");
    expect(lead.intel[0].entries[0].md).toBe("A lead paragraph.");
  });
});
