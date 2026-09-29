/**
 * Phase 4: the question gate, over the standing question queue (`src/questions/`).
 *
 * The run no longer opens a session of its own. Its candidates - personal mail the classifier
 * flagged as missing context - go through the reconcile call against every question still open,
 * so a sender asked about yesterday is not asked again today, and an open question that a note or
 * a correction has settled in the meantime is closed. Section 2 then waits, up to
 * `TIMEOUT_MINUTES`, for the questions this run's mail landed on, and for nothing else: an old
 * review question left open does not hold up the morning. The reader answers one at a time on
 * `/questions`, and each answer counts the moment it is sent.
 *
 * What Section 2 receives is every item answer of the last `ANSWER_DAYS`, not only this morning's,
 * since an answer sent after yesterday's briefing went out is just as much news to today's.
 */
import { and, eq } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { mechanicalPlan, reconcileQueue, type CandidateInput } from "../questions/reconcile";
import { applyPlan, askedExtractionIds, listOpen, listRecentlyAnswered, setBlocking, stillOpen } from "../questions/store";
import type { ContextPayload } from "./phase3-context";
import { absorbReviewAnswers } from "./weekly-review";
import { StepError, withRetry, type StepAttemptError } from "./withRetry";

const TIMEOUT_MINUTES = 45;
const POLL_INTERVAL_MS = 10_000;
const ANSWER_DAYS = 7;
const EXCERPT_CHARS = 700;

export interface QuestionAnswer {
  question: string;
  answer: string;
  about: string[];
  answered: string | null;
}

export interface GateResult {
  /** Whether Section 2 had anything of this run's to wait for. */
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
  return { subject, body: (cut >= 0 ? text.slice(cut + 2) : text).replace(/\s+/g, " ").trim() };
}

/** This run's mail that the classifier could not place, minus anything a question already carries. */
async function candidatesFor(runDate: string): Promise<CandidateInput[]> {
  const [rows, asked] = await Promise.all([
    db
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
      .where(and(eq(extractions.runDate, runDate), eq(extractions.unknownContext, true))),
    askedExtractionIds(),
  ]);

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
async function tolerantAbsorb(errors: StepAttemptError[]) {
  try {
    return await withRetry("phase4-review", () => absorbReviewAnswers());
  } catch (err) {
    if (err instanceof StepError) errors.push(...err.attempts);
    console.error("[Phase 4] Review answers not absorbed, the next run retries:", err);
    return { tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  }
}

/**
 * Reconciles this run's candidates into the queue and returns the questions Section 2 should wait
 * for. The reconcile call is tolerant: when it exhausts its retries the queue still gets the
 * candidates through `mechanicalPlan`, and its attempts go to `step_errors`.
 */
async function openQuestions(ctx: ContextPayload, runDate: string, errors: StepAttemptError[]) {
  const candidates = await candidatesFor(runDate);
  const absorbed = await tolerantAbsorb(errors);

  let usage = { tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  let plan;
  try {
    const result = await withRetry("phase4-questions", () =>
      reconcileQueue(candidates, runDate, { longTermContext: ctx.longTermContext }),
    );
    plan = result.plan;
    usage = result;
  } catch (err) {
    if (err instanceof StepError) errors.push(...err.attempts);
    console.error("[Phase 4] Question reconcile failed, adding the candidates by sender only:", err);
    plan = mechanicalPlan(candidates, await listOpen());
  }

  const waitFor = await applyPlan(plan, runDate);
  return {
    waitFor,
    newQuestionCount: plan.created.length,
    tokensIn: usage.tokensIn + absorbed.tokensIn,
    tokensOut: usage.tokensOut + absorbed.tokensOut,
    aiCalls: usage.aiCalls + absorbed.aiCalls,
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

/** Phase 4 in full: reconcile, then wait for this run's questions. Runs alongside Section 1. */
export async function runQuestionGate(ctx: ContextPayload, runDate: string, errors: StepAttemptError[]): Promise<GateResult> {
  const opened = await withRetry("phase4", () => openQuestions(ctx, runDate, errors));
  const usage = { tokensIn: opened.tokensIn, tokensOut: opened.tokensOut, aiCalls: opened.aiCalls };

  if (opened.waitFor.length === 0) {
    console.log("[Phase 4] Nothing of this run's to ask - Section 2 does not wait");
    return { fired: false, answers: await recentAnswers(), newQuestionCount: opened.newQuestionCount, ...usage };
  }

  const deadline = new Date(Date.now() + TIMEOUT_MINUTES * 60_000);
  await setBlocking(opened.waitFor, deadline);
  console.log(`[Phase 4] Waiting up to ${TIMEOUT_MINUTES} min for ${opened.waitFor.length} question(s)`);

  let open = opened.waitFor;
  while (open.length > 0 && Date.now() < deadline.getTime()) {
    await Bun.sleep(POLL_INTERVAL_MS);
    open = await stillOpen(open);
  }

  // Unanswered ones stay in the queue: only this morning stops waiting for them.
  await setBlocking(open, null);
  console.log(
    open.length === 0
      ? "[Phase 4] All of this run's questions settled"
      : `[Phase 4] Timed out with ${open.length} question(s) still open - they stay on /questions`,
  );
  return { fired: true, answers: await recentAnswers(), newQuestionCount: opened.newQuestionCount, ...usage };
}
