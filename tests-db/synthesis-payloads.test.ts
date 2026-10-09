// src/pipeline/phase5-synthesis.ts against real SQL: what Section 1, Section 2 and the News editor are
// sent, which prompt they run with and what Section 1 marks as handed over. Only `synthesize` is a mock.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Any = Record<string, any>;
type Call = { prompt: string; payload: Any; options: Any };
const calls: Call[] = [];
let reply = { text: "", tokensIn: 100, tokensOut: 20 };
let failure: Error | null = null;

mock.module("../src/ai/openai", () => ({
  synthesize: async (prompt: string, payload: string, options: Any) => {
    calls.push({ prompt, payload: JSON.parse(payload), options });
    if (failure) throw failure;
    return reply;
  },
}));

const database = await useTestDatabase();
const { runSection1, runSection2, runNewsSection } = await import("../src/pipeline/phase5-synthesis");
const { activePrompt } = await import("../src/ai/active-prompts");
const { SECTION1_CAPACITY } = await import("../src/pipeline/section1-handoff");

const DAY = "2026-10-05";

beforeEach(async () => {
  calls.length = 0;
  reply = { text: "", tokensIn: 100, tokensOut: 20 };
  failure = null;
  await database.sql`truncate raw_items, extractions, prompt_versions, notes cascade`;
});

const extraction = (id: string, json: Any = {}, over: Any = {}) => ({
  extraction: { id, extractedJson: json, effectiveRelevance: 3.5, novelty: "new", ...over },
  sourceName: "Example Weekly",
  sourceType: "newsletter",
  gate: {},
});

const story = (desk: string, headline: string, significance: number, sources: Any[] = []) => ({
  desk, headline, key_claim: `${headline}, in short`, context: "", significance, status: "new", confidence: "confirmed",
  region: "global", topic: "news", happened_at: "2026-10-05T01:00:00Z", entities: [], sources, validation: {},
});
const newsItem = (id: string, s: Any) => ({ extraction: { id, extractedJson: s }, sourceName: "news:" + s.desk, sourceType: "news", gate: {} });

const baseCtx = (over: Any = {}) => ({
  volumeSignal: "normal", highRelevanceCount: 2, activeTopics: [], revivableTopics: [], newsletterItems: [], personalItems: [],
  newsItems: [], newsDesk: { home: null }, entityContexts: [], notesIntel: [], notesPersonal: [], knownContacts: [],
  calendarItems: [], todoItems: [], webSearchResults: [],
  longTermContext: { corrections: [], intelSections: "", personalSections: "", interestSections: "", generatedAt: null, problem: null },
  ...over,
}) as never;

const insertExtractions = async (count: number) => {
  const rows = await database.sql`insert into extractions (run_date) select ${DAY}::date from generate_series(1, ${count}) returning id`;
  return rows.map((r: Any) => r.id as string);
};

describe("Section 1", () => {
  test("sends the day's items, the topics and the profile, with the News headlines the reader already has", async () => {
    await runSection1(baseCtx({
      volumeSignal: "heavy",
      highRelevanceCount: 7,
      activeTopics: [{ id: "t1", headline: "Chip export rules", domain: "Geopolitics", runningSummary: "Rules tighten", updateCount: 4, status: "active" }],
      revivableTopics: [{ id: "t2", headline: "Old merger", domain: "Finance", runningSummary: "Stalled", updateCount: 1, status: "dormant" }],
      newsletterItems: [extraction("11111111-1111-4111-8111-111111111111", { headline: "A claim", entities: ["Acme"] }, { effectiveRelevance: 4.2, novelty: "continuation" })],
      entityContexts: [{ name: "Acme", type: "company", summary: "Makes anvils", mentionCount: 9 }],
      notesIntel: [{ content: "Watch chips", scope: "intel" }],
      newsItems: [newsItem("n1", story("world", "Parliament approves the budget", 4))],
      longTermContext: { corrections: [], intelSections: "Interested in chips", personalSections: "Private", interestSections: "", generatedAt: null, problem: null },
    }), DAY);

    expect(calls[0].payload).toEqual({
      report_date: DAY,
      volume_signal: "heavy",
      high_relevance_count: 7,
      active_topics: [{ id: "t1", headline: "Chip export rules", domain: "Geopolitics", summary: "Rules tighten", update_count: 4 }],
      revivable_topics: [{ id: "t2", headline: "Old merger", domain: "Finance", summary: "Stalled", status: "dormant" }],
      todays_items: [{ id: "11111111-1111-4111-8111-111111111111", source: "Example Weekly", effective_relevance: 4.2, novelty: "continuation", headline: "A claim", entities: ["Acme"] }],
      entity_contexts: [{ name: "Acme", type: "company", summary: "Makes anvils", mention_count: 9 }],
      notes_intel: ["Watch chips"],
      news_headlines: ["Parliament approves the budget"],
      already_told: null,
      long_term_context: "Interested in chips",
      context_corrections: null,
      web_search: { slot1_topic_deepdive: null, slot2_dormant_entity: null },
    });
    expect(JSON.stringify(calls[0].payload)).not.toContain("Private");
  });

  test("an empty day sends nulls where the prompt is told to proceed unchanged", async () => {
    await runSection1(baseCtx(), DAY);
    expect(calls[0].payload).toMatchObject({ todays_items: [], news_headlines: null, already_told: null, long_term_context: null, context_corrections: null });
  });

  test("already_told carries earlier days' news and briefing items, never today's", async () => {
    const insertTold = async (sourceType: string, runDate: string, json: Any, i: number) => {
      const [raw] = await database.sql`insert into raw_items (run_date, source_type, source_name, message_id, raw_content, received_at)
        values (${runDate}, ${sourceType}, 'x', ${`told-${i}`}, 'x', ${`${runDate}T05:00:00Z`}) returning id`;
      await database.sql`insert into extractions (raw_item_id, run_date, extracted_json, included_in_report, ai_failed)
        values (${raw.id}, ${runDate}, ${json}, true, false)`;
    };
    await insertTold("newsletter", "2026-10-04", { headline: "Grid storage startup raises a round", key_claim: "It raised 50 million" }, 1);
    await insertTold("web_news", "2026-10-03", { headline: "Parliament approves the budget", sources: [] }, 2);
    await insertTold("newsletter", DAY, { headline: "Today's own item" }, 3);

    await runSection1(baseCtx(), DAY);
    expect(calls[0].payload.already_told).toEqual([
      { date: "2026-10-03", headline: "Parliament approves the budget" },
      { date: "2026-10-04", headline: "Grid storage startup raises a round", summary: "It raised 50 million" },
    ]);
  });

  test("a failed read of what was told costs the repeat guard, not the briefing", async () => {
    await database.sql`alter table extractions rename to extractions_gone`;
    try {
      reply = { text: "## Section 1", tokensIn: 1, tokensOut: 1 };
      const result = await runSection1(baseCtx(), DAY);
      expect(calls[0].payload.already_told).toBeNull();
      expect(result.text).toBe("## Section 1");
    } finally {
      await database.sql`alter table extractions_gone rename to extractions`;
    }
  });

  test("the user's corrections go beside the profile in the shape the prompt reads", async () => {
    await runSection1(baseCtx({
      longTermContext: {
        corrections: [{ id: "c1", targetKind: "entity", targetKey: "Acme", operation: "amend", statement: "Acme makes rockets", supersedesText: "Acme makes anvils", createdAt: null }],
        intelSections: "", personalSections: "", interestSections: "", generatedAt: null, problem: null,
      },
    }), DAY);
    expect(calls[0].payload.context_corrections).toEqual([
      { about: "entity:Acme", operation: "amend", correct: "Acme makes rockets", incorrect: "Acme makes anvils" },
    ]);
  });

  test("slot 1 and slot 2 of the web search arrive under their own keys, slot 3 does not", async () => {
    await runSection1(baseCtx({
      webSearchResults: [
        { slot: 3, query: "q3", target: "Someone", results: [{ title: "three" }] },
        { slot: 2, query: "q2", entityName: "Dormant Co", results: [{ title: "two" }] },
        { slot: 1, query: "q1", topicId: "t1", results: [{ title: "one" }] },
      ],
    }), DAY);
    expect(calls[0].payload.web_search).toEqual({
      slot1_topic_deepdive: { query: "q1", topic_id: "t1", results: [{ title: "one" }] },
      slot2_dormant_entity: { query: "q2", entity: "Dormant Co", results: [{ title: "two" }] },
    });
    expect(JSON.stringify(calls[0].payload)).not.toContain("q3");
  });

  test("hands over the first SECTION1_CAPACITY items and marks exactly those as sent", async () => {
    const ids = await insertExtractions(SECTION1_CAPACITY + 3);
    await runSection1(baseCtx({ newsletterItems: ids.map((id) => extraction(id)) }), DAY);

    expect(calls[0].payload.todays_items.map((i: Any) => i.id)).toEqual(ids.slice(0, SECTION1_CAPACITY));
    const marked = await database.sql`select id, synthesis_handoff from extractions`;
    expect(marked.filter((r: Any) => r.synthesis_handoff === "sent").map((r: Any) => r.id).sort()).toEqual(ids.slice(0, SECTION1_CAPACITY).sort());
    expect(marked.filter((r: Any) => r.synthesis_handoff === null)).toHaveLength(3);
  });

  test("runs at high effort with room for the reasoning, and returns the model's text and usage", async () => {
    reply = { text: "## Section 1", tokensIn: 321, tokensOut: 45 };
    const result = await runSection1(baseCtx(), DAY);
    expect(calls[0].options).toMatchObject({ reasoningEffort: "high", maxOutputTokens: 12000 });
    expect(result).toMatchObject({ text: "## Section 1", tokensIn: 321, tokensOut: 45 });
  });

  test("a failed call marks nothing as sent", async () => {
    const ids = await insertExtractions(2);
    failure = new Error("model down");
    await expect(runSection1(baseCtx({ newsletterItems: ids.map((id) => extraction(id)) }), DAY)).rejects.toThrow("model down");
    expect(await database.sql`select id from extractions where synthesis_handoff is not null`).toEqual([]);
  });
});

describe("the prompt", () => {
  test("is the one active on /prompts, so an activation applies to the next run without a deploy", async () => {
    const baseline = await activePrompt("section2");
    await runSection2(baseCtx(), DAY);
    expect(calls[0].prompt).toBe(baseline.text);

    await database.sql`insert into prompt_versions (version, section, prompt_text, active) values (9, 'section2', 'the approved prompt', true), (8, 'section2', 'an older one', false)`;
    await runSection2(baseCtx(), DAY);
    expect(calls[1].prompt).toBe("the approved prompt");

    await runSection1(baseCtx(), DAY);
    expect(calls[2].prompt).not.toBe("the approved prompt");
  });
});

describe("Section 2", () => {
  test("sends personal mail, calendar and tasks, and only four fields of each known contact", async () => {
    await runSection2(baseCtx({
      personalItems: [{ ...extraction("p1", { type: "request", urgency: "high" }), sourceType: "personal_email", sourceName: "friend@example.com" }],
      calendarItems: [{ summary: "Dentist" }],
      todoItems: [{ title: "Pay rent" }],
      knownContacts: [{ identifier: "friend@example.com", name: "A Friend", relationship: "friend", priority: "high", notes: "private detail", id: "c1" }],
      notesPersonal: [{ content: "Keep it short" }],
      longTermContext: { corrections: [], intelSections: "Intel", personalSections: "Who I am", interestSections: "", generatedAt: null, problem: null },
    }), DAY);

    expect(calls[0].payload).toEqual({
      report_date: DAY,
      personal_items: [{ id: "p1", source_type: "personal_email", source: "friend@example.com", type: "request", urgency: "high" }],
      question_answers: null,
      calendar_next_7_days: [{ summary: "Dentist" }],
      active_todos: [{ title: "Pay rent" }],
      known_contacts: [{ identifier: "friend@example.com", name: "A Friend", relationship: "friend", priority: "high" }],
      notes_personal: ["Keep it short"],
      long_term_context: "Who I am",
      context_corrections: null,
      web_search_mentions: null,
    });
  });

  test("question answers are passed along only when there are some", async () => {
    await runSection2(baseCtx(), DAY, []);
    expect(calls[0].payload.question_answers).toBeNull();

    const answers = [{ question: "Who is Sam?", answer: "My landlord", about: ["sam@example.com"], answered: "2026-10-04" }];
    await runSection2(baseCtx(), DAY, answers);
    expect(calls[1].payload.question_answers).toEqual(answers);
  });

  test("slot 3 arrives as the mention search, with the person it is about", async () => {
    await runSection2(baseCtx({ webSearchResults: [{ slot: 1, query: "q1", results: [] }, { slot: 3, query: "q3", target: "Sam", results: [{ title: "hit" }] }] }), DAY);
    expect(calls[0].payload.web_search_mentions).toEqual({ target: "Sam", query: "q3", results: [{ title: "hit" }] });
  });
});

describe("the News section", () => {
  test("a day without stories makes no call and returns an empty section", async () => {
    expect(await runNewsSection(baseCtx(), DAY)).toEqual({ text: "", tokensIn: 0, tokensOut: 0, aiCalls: 0 });
    expect(calls).toHaveLength(0);
  });

  test("the editor sees the stories in desk order under short ids, the home, and only the intel notes", async () => {
    const home = { city: "Zurich", region: null, country: "CH", countryName: "Switzerland", also: [{ code: "DE", name: "Germany" }], label: "Zurich & Switzerland" };
    await database.sql`insert into notes (content, scope, steps) values
      ('Chips', 'intel', '{}'), ('News only', 'intel', '{news}'), ('Section 1 only', 'intel', '{section1}'), ('Tighten the prompt', 'global', '{}')`;
    await runNewsSection(baseCtx({
      newsDesk: { home },
      newsItems: [
        newsItem("x-talk", story("talk", "Festival award", 5)),
        newsItem("x-low", story("world", "Minor vote", 2)),
        newsItem("x-top", story("world", "Budget passes", 5, [{ publisher: "Example News", url: "https://news.example.com/a", title: "T" }])),
      ],
    }), DAY);

    const sent = calls[0].payload;
    expect(sent.stories.map((s: Any) => [s.id, s.headline])).toEqual([["n1", "Budget passes"], ["n2", "Minor vote"], ["n3", "Festival award"]]);
    expect(sent.stories[0].publishers).toEqual(["Example News"]);
    expect(JSON.stringify(sent.stories)).not.toContain("https://");
    expect(sent.home).toEqual({ label: "Zurich & Switzerland", also_countries: ["Germany"] });
    expect([...sent.notes_intel].sort()).toEqual(["Chips", "News only"]);
    expect(calls[0].options).toMatchObject({ reasoningEffort: "high", maxOutputTokens: 12000 });
  });

  test("short ids in the editor's text become extraction ids with the checked links, and the heading is guaranteed", async () => {
    reply = { text: "Parliament passed the budget. <!--refs:n1-->\n\nIgnored ref. <!--refs:n9-->", tokensIn: 50, tokensOut: 10 };
    const result = await runNewsSection(baseCtx({
      newsItems: [newsItem("x-top", story("world", "Budget passes", 5, [{ publisher: "Example News", url: "https://news.example.com/a", title: "T" }]))],
    }), DAY);

    expect(result).toMatchObject({ tokensIn: 50, tokensOut: 10, aiCalls: 1 });
    expect(result.text).toStartWith("## News");
    expect(result.text).toContain("[Example News](https://news.example.com/a) <!--refs:x-top-->");
    expect(result.text).not.toContain("n9");
  });
});
