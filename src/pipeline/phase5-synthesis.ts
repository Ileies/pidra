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
  });
}

function buildSection2Payload(ctx: ContextPayload, questionAnswers: Record<string, string> = {}): string {
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
  });
}

export async function runSection1(ctx: ContextPayload): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  console.log("[Phase 5] Section 1 synthesis starting");
  const result = await synthesize(SECTION1_SYSTEM_PROMPT, buildSection1Payload(ctx));
  console.log(`[Phase 5] Section 1 done — ${result.tokensIn} in, ${result.tokensOut} out`);
  return result;
}

export async function runSection2(
  ctx: ContextPayload,
  questionAnswers: Record<string, string> = {}
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  console.log("[Phase 5] Section 2 synthesis starting");
  const result = await synthesize(SECTION2_SYSTEM_PROMPT, buildSection2Payload(ctx, questionAnswers));
  console.log(`[Phase 5] Section 2 done — ${result.tokensIn} in, ${result.tokensOut} out`);
  return result;
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
