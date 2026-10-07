/**
 * Keeps the standing question queue free of repeats: one `extractJson()` call (prompt section
 * `questions`) turns the open questions plus new candidates into a `QueuePlan`, which
 * `apply-plan.ts` writes. Reads `questions`, `notes`, `contacts` and the long-term context.
 * How the answer becomes a plan (and the fail-open rules) lives in `plan.ts`; this file builds the
 * model's input and makes the call.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { contacts, db } from "../db";
import { selectNotes } from "../notes/select";
import { activePrompt } from "../ai/active-prompts";
import { extractJson, usageTally } from "../ai/openai";
import { formatForPrompt } from "../context/corrections";
import { loadLongTermContext, type LongTermContext } from "../pipeline/long-term-context";
import type { QueuePlan } from "./apply-plan";
import { buildPlan, capCreated, emptyPlan, type ModelAnswer } from "./plan";
import { listOpen, listRecentlyAnswered, type Candidate, type Question } from "./store";

/** How far back answers count as "the reader already said this". */
const ANSWER_MEMORY_DAYS = 30;

const SCHEMA = {
  name: "question_queue",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["existing", "candidates", "new_questions"],
    properties: {
      existing: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "action", "question", "into", "reason"],
          properties: {
            id: { type: "string" },
            action: { type: "string", enum: ["keep", "rewrite", "resolve", "merge"] },
            question: { type: "string" },
            into: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "action", "target", "reason"],
          properties: {
            id: { type: "string" },
            action: { type: "string", enum: ["ask", "attach", "drop"] },
            target: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      new_questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "question"],
          properties: { id: { type: "string" }, question: { type: "string" } },
        },
      },
    },
  },
};

/** A candidate as the model sees it: the mail's classification and an excerpt, not the whole mail. */
export interface CandidateInput extends Candidate {
  detail?: Record<string, unknown>;
}

export interface ReconcileResult {
  plan: QueuePlan;
  /** How many open questions the plan was made against. */
  openCount: number;
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
}

function sendersOf(open: Question[], candidates: Candidate[]): string[] {
  return [
    ...new Set([
      ...open.flatMap((q) => q.sources.map((s) => s.from.toLowerCase())),
      ...candidates.flatMap((c) => (c.source ? [c.source.from.toLowerCase()] : [])),
    ]),
  ];
}

/**
 * The plan for this run's candidates against the open queue. Makes no call when there is nothing
 * to reconcile; with open questions but no candidates it still runs, since a note written
 * yesterday may have answered one of them.
 */
export async function reconcileQueue(
  candidates: CandidateInput[],
  today: string,
  opts: { longTermContext?: LongTermContext } = {},
): Promise<ReconcileResult> {
  const open = await listOpen();
  if (open.length === 0 && candidates.length === 0) {
    return { plan: emptyPlan(), openCount: 0, tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  }

  const senders = sendersOf(open, candidates);
  const [longTermContext, answered, noteRows, contactRows] = await Promise.all([
    opts.longTermContext ?? loadLongTermContext(),
    listRecentlyAnswered(ANSWER_MEMORY_DAYS),
    selectNotes("reconcile", today),
    senders.length > 0 ? db.select().from(contacts).where(and(inArray(contacts.identifier, senders), isNull(contacts.removedAt))) : Promise.resolve([]),
  ]);

  const openIds = new Map(open.map((q, i) => [`q${i + 1}`, q]));
  const candidateIds = new Map(candidates.map((c, i) => [`c${i + 1}`, c]));

  const payload = {
    today,
    open_questions: [...openIds].map(([id, q]) => ({
      id,
      kind: q.kind,
      question: q.question,
      about: q.sources.map((s) => ({ type: s.source_type, from: s.from, subject: s.subject, date: s.run_date })),
      first_asked: q.firstAsked,
      times_asked: q.timesAsked,
    })),
    candidates: [...candidateIds].map(([id, c]) => ({
      id,
      kind: c.kind,
      question: c.question,
      about: c.source ? { type: c.source.source_type, from: c.source.from, subject: c.source.subject, date: c.source.run_date } : null,
      ...(c.detail ? { mail: c.detail } : {}),
    })),
    recently_answered: answered.map((q) => ({
      question: q.question,
      answer: q.answer,
      answered: q.answeredAt?.slice(0, 10) ?? null,
      about: [...new Set(q.sources.map((s) => s.from))],
    })),
    known_contacts: contactRows.map((c) => ({
      identifier: c.identifier,
      name: c.name,
      relationship: c.relationship,
      notes: c.contextNotes,
    })),
    notes: noteRows.map((n) => ({ written: n.createdAt?.slice(0, 10) ?? null, text: n.content.slice(0, 600) })),
    context_corrections: longTermContext.corrections.length > 0 ? formatForPrompt(longTermContext.corrections) : null,
    long_term_context: longTermContext.personalSections || null,
  };

  const prompt = await activePrompt("questions");
  const usage = usageTally();
  const answer = await extractJson<ModelAnswer>(prompt.text, JSON.stringify(payload), {
    schema: SCHEMA,
    // Deciding that two questions are "the same" or that a note settles one is the whole job.
    reasoningEffort: "high",
    maxOutputTokens: 10000,
    onUsage: usage.onUsage,
  });

  const plan = capCreated(buildPlan(answer, openIds, candidateIds));
  console.log(
    `[Questions] ${open.length} open, ${candidates.length} candidate(s): ` +
      `${plan.created.length} new, ${plan.attaches.length} attached, ${plan.dropped.length} dropped, ` +
      `${plan.rewrites.length} rephrased, ${plan.merges.length} merged, ${plan.resolves.length} resolved`,
  );
  return { plan, openCount: open.length, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, aiCalls: 1 };
}
