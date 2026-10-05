// src/pipeline/phase6/system-block.ts against real SQL: the `<!--SYSTEM {json}-->` block each
// synthesis section appends drives every memory write of Phase 6. The block is model output, so a
// bad entry must be skipped and never stop the good ones. Only the skill-suggestion processor is a
// mock (it would run real skills); the topic capacity rules are the real ones.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const suggestions: { suggestions: unknown[]; runDate: string; triggeredBy: string }[] = [];
mock.module("../src/pipeline/phase6/skill-suggestions", () => ({
  processSkillSuggestions: async (list: unknown[], runDate: string, triggeredBy: string) => {
    suggestions.push({ suggestions: list, runDate, triggeredBy });
  },
}));

const database = await useTestDatabase();
const { db, activeTopics } = await import("../src/db");
const block = await import("../src/pipeline/phase6/system-block");
const { TOPIC_ACTIVE_CAP } = await import("../src/pipeline/topic-lifecycle");

const DAY = "2026-10-05";
const YESTERDAY = "2026-10-04";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(async () => {
  suggestions.length = 0;
  await database.sql`truncate active_topics, entities, contacts, notes cascade`;
});

async function topic(over: Partial<typeof activeTopics.$inferInsert> = {}) {
  const [row] = await db
    .insert(activeTopics)
    .values({ headline: "Existing topic", domain: "Finance", runningSummary: "old", firstSeen: "2026-09-01", lastUpdated: YESTERDAY, status: "active", importance: "normal", updateCount: 3, ...over })
    .returning();
  return row!;
}
const topics = async () => (await db.select().from(activeTopics)) as (typeof activeTopics.$inferSelect)[];
const byHeadline = async (h: string) => (await topics()).find((t) => t.headline === h);

describe("parseSystemBlock", () => {
  test("reads the block out of a section, whitespace and newlines included", () => {
    const text = `Some report text\n\n<!--SYSTEM\n{\n  "new_topics": [{"headline": "A", "domain": "B", "summary": "C"}]\n}\n-->\n`;
    expect(block.parseSystemBlock<{ new_topics: unknown[] }>(text)?.new_topics).toHaveLength(1);
    expect(block.parseSystemBlock('<!--SYSTEM{"a":1}-->')).toEqual({ a: 1 } as never);
  });

  test("is null when there is no block or it is not valid JSON, and it takes the first block only", () => {
    expect(block.parseSystemBlock("just a report")).toBeNull();
    expect(block.parseSystemBlock("<!--SYSTEM {not json} -->")).toBeNull();
    expect(block.parseSystemBlock("<!--SYSTEM -->")).toBeNull();
    expect(block.parseSystemBlock('<!--SYSTEM {"first":true}--> text <!--SYSTEM {"second":true}-->')).toEqual({ first: true } as never);
  });

  test("a block that is JSON but not an object is no block", () => {
    for (const body of ["null", "5", '"text"', "[]", "[1,2]", "true"]) {
      expect(block.parseSystemBlock(`<!--SYSTEM ${body} -->`)).toBeNull();
    }
  });
});

describe("applySection1SystemBlock: topic updates", () => {
  test("refreshes an active topic: new summary, the run date, and one more update on a new day only", async () => {
    const t = await topic();
    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "  fresh summary  " }] }, DAY);
    let row = (await topics())[0]!;
    expect([row.runningSummary, row.lastUpdated, row.updateCount, row.importance]).toEqual(["fresh summary", DAY, 4, "normal"]);

    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "again" }] }, DAY);
    row = (await topics())[0]!;
    expect([row.runningSummary, row.updateCount]).toEqual(["again", 4]);
  });

  test("importance is changed only when the model revised it", async () => {
    const t = await topic({ importance: "high" });
    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "x" }] }, DAY);
    expect((await topics())[0]!.importance).toBe("high");
    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "x", importance: "low" }] }, DAY);
    expect((await topics())[0]!.importance).toBe("low");
  });

  test("a resolution needs evidence; one without is ignored", async () => {
    const [a, b] = [await topic({ headline: "A" }), await topic({ headline: "B" })];
    await block.applySection1SystemBlock(
      { updated_topics: [{ id: a.id, status: "resolved", new_summary: "done" }, { id: b.id, status: "resolved", new_summary: "done", resolution_evidence: "the treaty was signed" }] },
      DAY,
    );
    expect((await byHeadline("A"))!.status).toBe("active");
    expect((await byHeadline("B"))!.status).toBe("resolved");
  });

  test("entries with a bad id, status or summary are skipped without touching the rest", async () => {
    const good = await topic({ headline: "Good" });
    await block.applySection1SystemBlock(
      {
        updated_topics: [
          { id: "not-a-uuid", status: "active", new_summary: "x" },
          { id: uuid(9), status: "paused" as never, new_summary: "x" },
          { id: good.id, status: "active", new_summary: "   " },
          { id: good.id, status: "active", new_summary: "kept" },
        ],
      },
      DAY,
    );
    expect((await byHeadline("Good"))!.runningSummary).toBe("kept");
  });

  test("a topic that is already resolved is not reopened by an update", async () => {
    const t = await topic({ status: "resolved" });
    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "back again" }] }, DAY);
    expect((await topics())[0]).toMatchObject({ status: "resolved", runningSummary: "old" });

    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "resolved", new_summary: "rewritten", resolution_evidence: "again" }] }, DAY);
    expect((await topics())[0]).toMatchObject({ status: "resolved", runningSummary: "old", lastUpdated: YESTERDAY });
  });

  test("a dormant topic asked back to active is revived when there is room", async () => {
    const t = await topic({ status: "dormant" });
    await block.applySection1SystemBlock({ updated_topics: [{ id: t.id, status: "active", new_summary: "news again" }] }, DAY);
    expect((await topics())[0]).toMatchObject({ status: "active", runningSummary: "news again", lastUpdated: DAY });
  });
});

describe("applySection1SystemBlock: new topics and the capacity of 15", () => {
  const fill = async (n: number, importance = "normal") => {
    for (let i = 0; i < n; i++) await topic({ headline: `Filler ${i}`, importance, updateCount: 2 + i });
  };

  test("a new topic is stored active with one update and a normalized importance", async () => {
    await block.applySection1SystemBlock({ new_topics: [{ headline: "Fresh", domain: "AI", summary: "what happened", importance: "urgent" }, { headline: "Key", domain: "AI", summary: "s", importance: "high" }] }, DAY);
    expect(await byHeadline("Fresh")).toMatchObject({ status: "active", updateCount: 1, firstSeen: DAY, lastUpdated: DAY, runningSummary: "what happened", importance: "normal", domain: "AI" });
    expect((await byHeadline("Key"))!.importance).toBe("high");
  });

  test("at capacity a normal topic does not displace anything", async () => {
    await fill(TOPIC_ACTIVE_CAP);
    await block.applySection1SystemBlock({ new_topics: [{ headline: "Newcomer", domain: "AI", summary: "s" }] }, DAY);
    expect(await byHeadline("Newcomer")).toBeUndefined();
    expect((await topics()).filter((t) => t.status === "active")).toHaveLength(TOPIC_ACTIVE_CAP);
  });

  test("at capacity a high topic demotes the weakest occupant to dormant and takes its slot", async () => {
    await fill(TOPIC_ACTIVE_CAP);
    await block.applySection1SystemBlock({ new_topics: [{ headline: "Breaking", domain: "AI", summary: "s", importance: "high" }] }, DAY);
    const all = await topics();
    expect(all.filter((t) => t.status === "active")).toHaveLength(TOPIC_ACTIVE_CAP);
    expect((await byHeadline("Breaking"))!.status).toBe("active");
    const dormant = all.filter((t) => t.status === "dormant");
    expect(dormant.map((t) => t.headline)).toEqual(["Filler 0"]);
  });

  test("a high-importance topic is never the one demoted", async () => {
    await topic({ headline: "Keystone", importance: "high", updateCount: 1 });
    await fill(TOPIC_ACTIVE_CAP - 1, "high");
    await block.applySection1SystemBlock({ new_topics: [{ headline: "Equal", domain: "AI", summary: "s", importance: "high" }] }, DAY);
    expect(await byHeadline("Equal")).toBeUndefined();
    expect((await topics()).filter((t) => t.status === "dormant")).toHaveLength(0);
  });

  test("candidates are admitted strongest first, so a high one wins the last free slot", async () => {
    await fill(TOPIC_ACTIVE_CAP - 1);
    await block.applySection1SystemBlock(
      { new_topics: [{ headline: "Minor", domain: "AI", summary: "s", importance: "low" }, { headline: "Major", domain: "AI", summary: "s", importance: "high" }] },
      DAY,
    );
    expect(await byHeadline("Major")).toBeDefined();
    expect(await byHeadline("Minor")).toBeUndefined();
  });
});

describe("applySection1SystemBlock: entities and skills", () => {
  test("new entities are stored once, a name that exists is left alone", async () => {
    await block.applySection1SystemBlock({ new_entities: [{ name: "Example Bank", type: "org", domain: "Finance" }, { name: "Example Bank", type: "person" }] }, DAY);
    const rows = (await database.sql`select name, type, domain, mention_count, first_seen::text from entities`) as { name: string; type: string; domain: string; mention_count: number; first_seen: string }[];
    expect(rows).toEqual([{ name: "Example Bank", type: "org", domain: "Finance", mention_count: 1, first_seen: DAY }]);
  });

  test("skill suggestions are handed on as report-section suggestions", async () => {
    const list = [{ skill: "add_todo_item", reason: "r", parameters: { title: "t" } }];
    await block.applySection1SystemBlock({ skill_suggestions: list }, DAY);
    expect(suggestions).toEqual([{ suggestions: list, runDate: DAY, triggeredBy: "report_section" }]);
  });
});

describe("applySection1SystemBlock: a malformed block never stops the good entries", () => {
  test("entries missing required fields are skipped and the valid ones around them are applied", async () => {
    await block.applySection1SystemBlock(
      {
        new_topics: [{ domain: "AI", summary: "no headline" }, { headline: "No domain", summary: "s" }, null, "text", { headline: "Valid", domain: "AI", summary: "s" }] as never,
        new_entities: [{ type: "org" }, { name: "   " }, { name: "Valid Entity" }] as never,
        updated_topics: [null, 7, { id: uuid(1), status: "active", new_summary: "x" }] as never,
      },
      DAY,
    );
    expect((await topics()).map((t) => t.headline)).toEqual(["Valid"]);
    const names = (await database.sql`select name from entities`) as { name: string }[];
    expect(names.map((e) => e.name)).toEqual(["Valid Entity"]);
  });

  test("a field that is not a list is ignored instead of failing the block", async () => {
    await block.applySection1SystemBlock(
      { updated_topics: "none" as never, new_topics: { headline: "x" } as never, new_entities: 5 as never, skill_suggestions: "all" as never },
      DAY,
    );
    expect(await topics()).toEqual([]);
    expect(suggestions.every((s) => Array.isArray(s.suggestions))).toBe(true);
  });
});

describe("applySection2SystemBlock", () => {
  const contacts = async () => (await database.sql`select identifier, name, relationship, priority from contacts order by identifier`) as { identifier: string; name: string | null; relationship: string | null; priority: string }[];
  const notes = async () => (await database.sql`select content, scope, created_by from notes order by content`) as { content: string; scope: string; created_by: string }[];

  test("stores valid new contacts with a default priority and leaves an existing one alone", async () => {
    await database.sql`insert into contacts (identifier, name) values ('known@example.com', 'Original')`;
    await block.applySection2SystemBlock({
      new_contacts: [
        { identifier: "new@example.com", name: "New Person", relationship: "colleague" },
        { identifier: "known@example.com", name: "Overwritten" },
        { name: "No identifier" },
      ],
    });
    expect(await contacts()).toEqual([
      { identifier: "known@example.com", name: "Original", relationship: null, priority: "normal" },
      { identifier: "new@example.com", name: "New Person", relationship: "colleague", priority: "normal" },
    ]);
  });

  test("a new_contacts that is not a list does not fail the block", async () => {
    await block.applySection2SystemBlock({ new_contacts: "everyone" });
    expect(await contacts()).toEqual([]);
  });

  test("writes notes as the system, global by default, and skips a malformed one", async () => {
    await block.applySection2SystemBlock({
      notes_to_write: [{ content: "Remember the offer ends Friday" }, { content: "Intel note", scope: "intel" }, { content: "" }, { content: "Bad scope", scope: "nonsense" }, null as never, { scope: "intel" } as never],
    });
    expect(await notes()).toEqual([
      { content: "Intel note", scope: "intel", created_by: "system" },
      { content: "Remember the offer ends Friday", scope: "global", created_by: "system" },
    ]);
  });

  test("notes_to_write that is not a list is ignored", async () => {
    await block.applySection2SystemBlock({ notes_to_write: "write this down" as never });
    await block.applySection2SystemBlock({ notes_to_write: { content: "x" } as never });
    expect(await notes()).toEqual([]);
  });
});
