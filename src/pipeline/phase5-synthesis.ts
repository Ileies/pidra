import { synthesize } from "../ai/openai";
import { SECTION1_SYSTEM_PROMPT, SECTION2_SYSTEM_PROMPT } from "../ai/prompts";
import type { ContextPayload } from "./phase3-context";

export interface SynthesisResult {
  section1: string;
  section2: string;
  tokensIn: number;
  tokensOut: number;
}

function buildSection1Payload(ctx: ContextPayload): string {
  const slot1 = ctx.webSearchResults.find((r) => r.slot === 1);
  const slot2 = ctx.webSearchResults.find((r) => r.slot === 2);

  return JSON.stringify({
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
    web_search: {
      slot1_topic_deepdive: slot1 ? { query: slot1.query, topic_id: slot1.topicId, results: slot1.results } : null,
      slot2_dormant_entity: slot2 ? { query: slot2.query, entity: slot2.entityName, results: slot2.results } : null,
    },
  });
}

function buildSection2Payload(ctx: ContextPayload, questionAnswers: Record<string, string> = {}): string {
  const slot3 = ctx.webSearchResults.find((r) => r.slot === 3);

  return JSON.stringify({
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
    web_search_mentions: slot3 ? { target: slot3.target, query: slot3.query, results: slot3.results } : null,
  });
}

async function synthesizeSection(name: string, prompt: string, payload: string) {
  console.log(`[Phase 5] ${name} synthesis starting`);
  const result = await synthesize(prompt, payload);
  console.log(`[Phase 5] ${name} done - ${result.tokensIn} in, ${result.tokensOut} out`);
  return result;
}

export function runSection1(ctx: ContextPayload) {
  return synthesizeSection("Section 1", SECTION1_SYSTEM_PROMPT, buildSection1Payload(ctx));
}

export function runSection2(ctx: ContextPayload, questionAnswers: Record<string, string> = {}) {
  return synthesizeSection("Section 2", SECTION2_SYSTEM_PROMPT, buildSection2Payload(ctx, questionAnswers));
}

export async function runPhase5(
  ctx: ContextPayload,
  questionAnswers: Record<string, string> = {}
): Promise<SynthesisResult> {
  const [s1, s2] = await Promise.all([
    runSection1(ctx),
    runSection2(ctx, questionAnswers),
  ]);
  return {
    section1: s1.text,
    section2: s2.text,
    tokensIn: s1.tokensIn + s2.tokensIn,
    tokensOut: s1.tokensOut + s2.tokensOut,
  };
}
