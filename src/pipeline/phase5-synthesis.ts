import { activePrompt, type PromptSection } from "../ai/active-prompts";
import { synthesize } from "../ai/openai";
import { formatForPrompt } from "../context/corrections";
import type { ContextPayload, ExtractionWithSource } from "./phase3-context";
import { editorPayload, finishNewsSection, type NewsItem } from "../news/format";
import type { NewsExtraction } from "../news/validate";

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

function buildSection1Payload(ctx: ContextPayload, runDate: string): string {
  const slot1 = ctx.webSearchResults.find((r) => r.slot === 1);
  const slot2 = ctx.webSearchResults.find((r) => r.slot === 2);

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
    todays_items: ctx.newsletterItems.slice(0, 30).map((i) => ({
      id: i.extraction.id,
      source: i.sourceName,
      effective_relevance: i.extraction.effectiveRelevance,
      novelty: i.extraction.novelty,
      ...(i.extraction.extractedJson as object),
    })),
    entity_contexts: ctx.entityContexts.map((e) => ({
      name: e.name,
      type: e.type,
      summary: e.summary,
      mention_count: e.mentionCount,
    })),
    notes_intel: ctx.notesIntel.map((n) => n.content),
    // What the News section of the same briefing already tells the reader. Without it Section 1
    // restates a headline the reader read a screen earlier, as analysis nobody asked for.
    news_headlines: ctx.newsItems.length > 0
      ? ctx.newsItems.map((i) => (i.extraction.extractedJson as NewsExtraction).headline)
      : null,
    // Interests and technical profile from the Context Builder document: what the user cares
    // about, for judging which of today's items actually matter to them.
    long_term_context: ctx.longTermContext.intelSections || null,
    // The user's own corrections to the profile above. Authoritative where they conflict with
    // it - the harvested text is never rewritten, so the two are shown side by side.
    context_corrections: corrections(ctx),
    web_search: {
      slot1_topic_deepdive: slot1 ? { query: slot1.query, topic_id: slot1.topicId, results: slot1.results } : null,
      slot2_dormant_entity: slot2 ? { query: slot2.query, entity: slot2.entityName, results: slot2.results } : null,
    },
  });
}

function buildSection2Payload(
  ctx: ContextPayload,
  runDate: string,
  questionAnswers: Record<string, string> = {},
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
    question_answers: Object.keys(questionAnswers).length > 0 ? questionAnswers : null,
    calendar_next_7_days: ctx.calendarItems,
    active_todos: ctx.todoItems,
    known_contacts: ctx.knownContacts.map((c) => ({
      identifier: c.identifier,
      name: c.name,
      relationship: c.relationship,
      priority: c.priority,
    })),
    notes_personal: ctx.notesPersonal.map((n) => n.content),
    // Context Builder output. standing_rules are the user's own persistent rules; identity,
    // commitments and standing context give the triage the background it needs to know who a
    // sender is and whether an item matters.
    standing_rules: ctx.longTermContext.standingRules.length > 0
      ? ctx.longTermContext.standingRules.map((r) => r.value)
      : null,
    long_term_context: ctx.longTermContext.personalSections || null,
    context_corrections: corrections(ctx),
    web_search_mentions: slot3 ? { target: slot3.target, query: slot3.query, results: slot3.results } : null,
  });
}

// The prompt is resolved here rather than imported, so activating a version on /prompts takes
// effect on the next run without a deploy. `activePrompt` falls back to the code constant.
async function synthesizeSection(name: string, section: PromptSection, payload: string) {
  const prompt = await activePrompt(section);
  const label = prompt.source === "db" ? `prompt v${prompt.version}` : "code prompt";
  console.log(`[Phase 5] ${name} synthesis starting (${label})`);
  const result = await synthesize(prompt.text, payload);
  console.log(`[Phase 5] ${name} done - ${result.tokensIn} in, ${result.tokensOut} out`);
  return result;
}

export function runSection1(ctx: ContextPayload, runDate: string) {
  return synthesizeSection("Section 1", "section1", buildSection1Payload(ctx, runDate));
}

export function runSection2(ctx: ContextPayload, runDate: string, questionAnswers: Record<string, string> = {}) {
  return synthesizeSection("Section 2", "section2", buildSection2Payload(ctx, runDate, questionAnswers));
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
    // Only intel notes: global ones include the weekly meta-run's proposals, which are about
    // prompts, not about what the reader wants covered.
    ctx.notesIntel.filter((n) => n.scope === "intel").map((n) => n.content),
    runDate,
  );

  const result = await synthesizeSection("News", "news", payload);
  return { text: finishNewsSection(result.text, refs), tokensIn: result.tokensIn, tokensOut: result.tokensOut, aiCalls: 1 };
}
