/**
 * Phase 4: the question gate, over the standing question queue (`src/questions/`).
 *
 * The run no longer opens a session of its own. Its candidates - personal mail the classifier
 * flagged as missing context, entities the graph keeps citing without ever placing
 * (`entity-questions.ts`), and known contacts a mail now sits oddly against
 * (`stale-context-questions.ts`) - go through the reconcile call against every question still
 * open, so a sender or entity asked about already is not asked again, and an open question that a
 * note or a correction has settled in the meantime is closed. Nothing waits on the questions:
 * Section 2 used to hold for up to 45 minutes for an answer nobody gave in time, which made
 * unattended mornings 45 minutes long. The reader answers one at a time on `/questions`, whenever
 * they get to it.
 *
 * What Section 2 receives is every item answer of the last `ANSWER_DAYS`, so an answer sent after
 * one briefing went out is used by the next run's.
 */
import { squash } from "../util/text";
import { and, eq } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { lowConfidenceEntityCandidates } from "./entity-questions";
import { staleContextCandidates } from "./stale-context-questions";
import { capCreated, mechanicalPlan, reconcileQueue, type CandidateInput } from "../questions/reconcile";
import { applyPlan } from "../questions/apply-plan";
import { askedExtractionIds, listOpen, listRecentlyAnswered } from "../questions/store";
import type { ContextPayload } from "./phase3-context";
import { absorbReviewAnswers } from "./weekly-review";
import { tolerant, withRetry, type StepAttemptError } from "./withRetry";

const ANSWER_DAYS = 7;
const EXCERPT_CHARS = 700;

export interface QuestionAnswer {
  question: string;
  answer: string;
  about: string[];
  answered: string | null;
}

export interface GateResult {
  /** Whether this run's candidates landed on any open question (stored as `question_gate_fired`). */
  fired: boolean;
  answers: QuestionAnswer[];
  /** Genuinely new questions this run added to the queue (`plan.created`) - what the questions push counts. */
  newQuestionCount: number;
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
}

/** `raw_content` of a mail is "Subject: ...\nFrom: ...\n\n<body>" (`src/ingest/imap.ts`). */
function splitMail(raw: string | null): { subject: string | null; body: string } {
  const text = raw ?? "";
  const subject = text.match(/^Subject: (.*)$/m)?.[1]?.trim() || null;
  const cut = text.indexOf("\n\n");
  return { subject, body: squash(cut >= 0 ? text.slice(cut + 2) : text) };
}

/** This run's mail that the classifier could not place, minus anything a question already carries. */
async function candidatesFor(runDate: string, asked: ReadonlySet<string>): Promise<CandidateInput[]> {
  const rows = await db
    .select({
      id: extractions.id,
      questionForUser: extractions.questionForUser,
      sourceName: rawItems.sourceName,
      sourceType: rawItems.sourceType,
      rawContent: rawItems.rawContent,
      extractedJson: extractions.extractedJson,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(extractions.unknownContext, true)));

  return rows
    .filter((row) => !asked.has(row.id))
    .map((row) => {
      const json = (row.extractedJson ?? {}) as Record<string, unknown>;
      const from = row.sourceName ?? "unknown";
      const { subject, body } = splitMail(row.rawContent);
      return {
        kind: "item" as const,
        question: row.questionForUser?.trim() || `Who is ${from}, and how do they relate to you?`,
        source: { extraction_id: row.id, from, subject, source_type: row.sourceType, run_date: runDate },
        detail: {
          type: json.type ?? null,
          urgency: json.urgency ?? null,
          action_required: json.action_required ?? null,
          excerpt: body.slice(0, EXCERPT_CHARS),
        },
      };
    });
}

/**
 * Review answers become insight notes here, the morning after they are given: the weekly review
 * job only asks now, it no longer sits for hours waiting to be answered. Costs the notes and
 * nothing else when it fails; the answers stay unabsorbed and the next run tries again.
 */
function tolerantAbsorb(errors: StepAttemptError[]) {
  return tolerant(
    "phase4-review",
    () => absorbReviewAnswers(),
    () => ({ tokensIn: 0, tokensOut: 0, aiCalls: 0 }),
    errors,
    "[Phase 4] Review answers not absorbed, the next run retries:",
  );
}

/**
 * Reconciles this run's candidates into the queue and returns the questions this run touched.
 * The reconcile call is tolerant: when it exhausts its retries the queue still gets the
 * candidates through `mechanicalPlan`, and its attempts go to `step_errors`.
 */
async function openQuestions(ctx: ContextPayload, runDate: string, errors: StepAttemptError[]) {
  const asked = await askedExtractionIds();
  const [mailCandidates, entityCandidates, staleCandidates] = await Promise.all([
    candidatesFor(runDate, asked),
    lowConfidenceEntityCandidates(runDate, asked),
    staleContextCandidates(runDate, asked),
  ]);
  const candidates = [...mailCandidates, ...entityCandidates, ...staleCandidates];
  const absorbed = await tolerantAbsorb(errors);

  const reconciled = await tolerant(
    "phase4-questions",
    () => reconcileQueue(candidates, runDate, { longTermContext: ctx.longTermContext }),
    async () => ({ plan: capCreated(mechanicalPlan(candidates, await listOpen())), tokensIn: 0, tokensOut: 0, aiCalls: 0 }),
    errors,
    "[Phase 4] Question reconcile failed, adding the candidates by sender only:",
  );
  const raised = await applyPlan(reconciled.plan, runDate);
  return {
    raised,
    newQuestionCount: reconciled.plan.created.length,
    tokensIn: reconciled.tokensIn + absorbed.tokensIn,
    tokensOut: reconciled.tokensOut + absorbed.tokensOut,
    aiCalls: reconciled.aiCalls + absorbed.aiCalls,
  };
}

async function recentAnswers(): Promise<QuestionAnswer[]> {
  return (await listRecentlyAnswered(ANSWER_DAYS))
    .filter((q) => q.kind === "item" && q.answer)
    .map((q) => ({
      question: q.question,
      answer: q.answer!,
      about: [...new Set(q.sources.map((s) => s.from))],
      answered: q.answeredAt?.slice(0, 10) ?? null,
    }));
}

/**
 * Phase 4 in full: reconcile this run's candidates into the queue and hand back the answers
 * already given. It never waits: a question raised this morning is answered whenever the reader
 * gets to it, and Section 2 of a later run uses the answer.
 */
export async function runQuestionGate(ctx: ContextPayload, runDate: string, errors: StepAttemptError[]): Promise<GateResult> {
  const opened = await withRetry("phase4", () => openQuestions(ctx, runDate, errors));
  const usage = { tokensIn: opened.tokensIn, tokensOut: opened.tokensOut, aiCalls: opened.aiCalls };

  const raised = opened.raised.length;
  console.log(
    raised === 0
      ? "[Phase 4] Nothing of this run's to ask"
      : `[Phase 4] ${raised} question(s) of this run's are open on /questions - Section 2 does not wait for them`,
  );
  return { fired: raised > 0, answers: await recentAnswers(), newQuestionCount: opened.newQuestionCount, ...usage };
}
