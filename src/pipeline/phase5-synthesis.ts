// Phase 5: stage two of the extraction/synthesis split. Builds the JSON payloads for Section 1,
// Section 2 and the News editor from the Phase 3 `ContextPayload` and calls `synthesize` (Section 1
// after its repeat judge, `section1-repeats.ts`, has left out what the reader was told); called by
// `run.ts`. The prompts are the active versions (`activePrompt`), not imported constants. The
// section outputs must keep the heading shape `report-json.ts` parses.
import { activePrompt, type PromptSection } from "../ai/active-prompts";
import { synthesize, type CallOptions } from "../ai/openai";
import { formatForPrompt } from "../context/corrections";
import type { ContextPayload } from "./phase3-context";
import type { ExtractionWithSource } from "./gate-items";
import type { QuestionAnswer } from "./phase4-questiongate";
import { editorPayload, finishNewsSection, type NewsItem } from "../news/format";
import type { NewsExtraction } from "../news/validate";
import { db, extractions } from "../db";
import { inArray } from "drizzle-orm";
import { selectNotes } from "../notes/select";
import { SECTION1_CAPACITY } from "./section1-handoff";
import { forModel } from "../util/extracted";
import { recentlyTold } from "./told";
import { judgeSection1Repeats, type Section1Verdict } from "./section1-repeats";
import type { ReportedStory } from "../news/validate";
import { squash } from "../util/text";

// Null rather than an empty array, matching how every other optional block in the payload
// signals "nothing here" - the prompts already say to proceed unchanged when a field is null.
function corrections(ctx: ContextPayload) {
  const active = ctx.longTermContext.corrections;
  return active.length > 0 ? formatForPrompt(active) : null;
}

export interface SynthesisResult {
  section1: string;
  section2: string;
  /** The News section, ready to place: refs are extraction ids and links are attached. May be "". */
  news: string;
  tokensIn: number;
  tokensOut: number;
  /** Every model call behind the report: syntheses and news desks alike. */
  aiCalls: number;
}

export function newsItemsOf(items: ExtractionWithSource[]): NewsItem[] {
  return items.map((i) => ({ id: i.extraction.id, story: i.extraction.extractedJson as NewsExtraction }));
}

/**
 * What the reader was told on the last days, for Section 1 to skip. The memory is a convenience: a
 * failed read costs the repeat guard for one run, never the briefing.
 */
async function alreadyTold(runDate: string): Promise<ReportedStory[]> {
  try {
    return await recentlyTold(runDate);
  } catch (err) {
    console.error("[Phase 5] Could not read what was already told, Section 1 runs without it:", err);
    return [];
  }
}

/** Today's News section as told stories: the reader reads it a screen before Section 1. */
function todaysNews(ctx: ContextPayload, runDate: string): ReportedStory[] {
  return ctx.newsItems.map((i) => {
    const story = i.extraction.extractedJson as NewsExtraction;
    return { date: runDate, headline: story.headline, urls: [], summary: squash(story.key_claim, 240) };
  });
}

function buildSection1Payload(
  ctx: ContextPayload,
  runDate: string,
  items: ExtractionWithSource[],
  told: ReportedStory[],
  verdict: Section1Verdict | null,
): string {
  const slot1 = ctx.webSearchResults.find((r) => r.slot === 1);

  return JSON.stringify({
    report_date: runDate,
    volume_signal: ctx.volumeSignal,
    high_relevance_count: ctx.highRelevanceCount,
    active_topics: ctx.activeTopics.map((t) => ({
      id: t.id,
      headline: t.headline,
      domain: t.domain,
      summary: t.runningSummary,
      update_count: t.updateCount,
    })),
    revivable_topics: ctx.revivableTopics.map((t) => ({
      id: t.id,
      headline: t.headline,
      domain: t.domain,
      summary: t.runningSummary,
      status: t.status,
    })),
    todays_items: items.map((i) => {
      const update = verdict?.updates.get(i.extraction.id);
      const group = verdict?.groups.get(i.extraction.id);
      return {
        id: i.extraction.id,
        source: i.sourceName,
        // Items sharing it were split out of one newsletter article.
        article: i.extraction.rawItemId,
        effective_relevance: i.extraction.effectiveRelevance,
        novelty: i.extraction.novelty,
        ...(update ? { already_told_as: update } : {}),
        ...(group ? { same_story_group: group } : {}),
        ...forModel(i.extraction.extractedJson),
      };
    }),
    notes_intel: ctx.notesIntel.map((n) => n.content),
    // What the News section of the same briefing already tells the reader. Without it Section 1
    // restates a headline the reader read a screen earlier, as analysis nobody asked for.
    news_headlines: ctx.newsItems.length > 0
      ? ctx.newsItems.map((i) => (i.extraction.extractedJson as NewsExtraction).headline)
      : null,
    // Earlier days' news stories and briefing items, so a newsletter repeating last week's deal is
    // skipped or reduced to what is new. `news_headlines` above is today's News section only.
    already_told: told.length > 0
      ? told.map(({ date, headline, summary }) => ({ date, headline, ...(summary ? { summary } : {}) }))
      : null,
    // Interests and technical profile from the Context Builder document: what the user cares
    // about, for judging which of today's items actually matter to them.
    long_term_context: ctx.longTermContext.intelSections || null,
    // The user's own corrections to the profile above. Authoritative where they conflict with
    // it - the harvested text is never rewritten, so the two are shown side by side.
    context_corrections: corrections(ctx),
    web_search: {
      slot1_topic_deepdive: slot1 ? { query: slot1.query, topic_id: slot1.topicId, results: slot1.results } : null,
    },
  });
}

function buildSection2Payload(
  ctx: ContextPayload,
  runDate: string,
  questionAnswers: QuestionAnswer[] = [],
): string {
  const slot3 = ctx.webSearchResults.find((r) => r.slot === 3);

  return JSON.stringify({
    report_date: runDate,
    personal_items: ctx.personalItems.map((i) => ({
      id: i.extraction.id,
      source_type: i.sourceType,
      source: i.sourceName,
      ...(i.extraction.extractedJson as object),
    })),
    question_answers: questionAnswers.length > 0 ? questionAnswers : null,
    calendar_next_7_days: ctx.calendarItems,
    active_todos: ctx.todoItems,
    known_contacts: ctx.knownContacts.map((c) => ({
      identifier: c.identifier,
      name: c.name,
      relationship: c.relationship,
      priority: c.priority,
    })),
    notes_personal: ctx.notesPersonal.map((n) => n.content),
    // Context Builder output: identity, commitments and standing context give the triage the
    // background it needs to know who a sender is and whether an item matters.
    long_term_context: ctx.longTermContext.personalSections || null,
    context_corrections: corrections(ctx),
    web_search_mentions: slot3 ? { target: slot3.target, query: slot3.query, results: slot3.results } : null,
  });
}

// The cap covers reasoning tokens too, so it sits well above the default 4096 that high effort would exhaust.
const BRIEFING_SECTION_OPTS: CallOptions = { reasoningEffort: "high", maxOutputTokens: 12000 };

// The prompt is resolved here rather than imported, so activating a version on /prompts takes
// effect on the next run without a deploy. `activePrompt` falls back to the code constant.
async function synthesizeSection(
  name: string,
  section: PromptSection,
  payload: string,
  opts: CallOptions = {},
) {
  const prompt = await activePrompt(section);
  const label = prompt.source === "db" ? `prompt v${prompt.version}` : "code prompt";
  console.log(`[Phase 5] ${name} synthesis starting (${label})`);
  const result = await synthesize(prompt.text, payload, opts);
  console.log(`[Phase 5] ${name} done - ${result.tokensIn} in, ${result.tokensOut} out`);
  return result;
}

/**
 * Side effect: marks the first SECTION1_CAPACITY items `extractions.synthesis_handoff = 'sent'`,
 * except those the repeat judge left out as already told, which are marked `already_told`.
 */
export async function runSection1(ctx: ContextPayload, runDate: string) {
  const selected = ctx.newsletterItems.slice(0, SECTION1_CAPACITY);
  const told = await alreadyTold(runDate);
  const judgeUsage = { tokensIn: 0, tokensOut: 0 };
  const verdict = await judgeSection1Repeats(selected, [...told, ...todaysNews(ctx, runDate)], judgeUsage);
  const sent = verdict ? selected.filter((i) => !verdict.repeats.has(i.extraction.id)) : selected;
  const payload = buildSection1Payload(ctx, runDate, sent, told, verdict);
  const result = await synthesizeSection("Section 1", "section1", payload, BRIEFING_SECTION_OPTS);
  const mark = async (items: ExtractionWithSource[], handoff: string) => {
    if (items.length === 0) return;
    await db.update(extractions)
      .set({ synthesisHandoff: handoff })
      .where(inArray(extractions.id, items.map((item) => item.extraction.id)));
  };
  await mark(sent, "sent");
  await mark(selected.filter((i) => !sent.includes(i)), "already_told");
  return { ...result, tokensIn: result.tokensIn + judgeUsage.tokensIn, tokensOut: result.tokensOut + judgeUsage.tokensOut };
}

export function runSection2(ctx: ContextPayload, runDate: string, questionAnswers: QuestionAnswer[] = []) {
  return synthesizeSection("Section 2", "section2", buildSection2Payload(ctx, runDate, questionAnswers), BRIEFING_SECTION_OPTS);
}

/**
 * The News section: the editor over the news stories that passed the gate. Returns an empty
 * section, and makes no call, on a day with no stories - the desks were off, or all of them failed,
 * which the report says above the briefing rather than in an empty heading.
 */
export async function runNewsSection(ctx: ContextPayload, runDate: string) {
  const items = newsItemsOf(ctx.newsItems);
  if (items.length === 0) return { text: "", tokensIn: 0, tokensOut: 0, aiCalls: 0 };

  const { payload, refs } = editorPayload(
    items,
    ctx.newsDesk.home,
    // The `news` step reads intel notes only, so the weekly meta-run's proposals never get here.
    (await selectNotes("news", runDate)).map((n) => n.content),
    runDate,
  );

  const result = await synthesizeSection("News", "news", payload, BRIEFING_SECTION_OPTS);
  return { text: finishNewsSection(result.text, refs, ctx.newsDesk.home), tokensIn: result.tokensIn, tokensOut: result.tokensOut, aiCalls: 1 };
}
