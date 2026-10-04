/**
 * The reader-facing writer of `questions` (`apply-plan.ts` is the pipeline's).
 *
 * Two parties write the queue and neither may undo the other. The pipeline adds, rephrases,
 * merges and closes open questions through `applyPlan`, which the reconcile call decides
 * (`reconcile.ts`); the reader answers, dismisses and reopens them from `/questions`, through the
 * bridge. Every pipeline write is guarded on `status = 'open'`, so a question answered while the
 * reconcile call was still thinking keeps its answer and its wording.
 *
 * Nothing is deleted. A closed question keeps its status and the reason, and a rephrased one keeps
 * each earlier wording on `history`, so the page can say what changed and a wrong close can be
 * reopened. Every write also appends to `question_events` (`events.ts`), the append-only outcome
 * log that lets the reconcile step's merge/resolve/drop calls be judged against real history.
 */
import { HttpError } from "../util/errors";
import { utcDay } from "../util/time";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, questionEvents, questions, type QuestionSource } from "../db";
import { logEvent } from "./events";
import { teachContact } from "./teach-contact";

export type Question = typeof questions.$inferSelect;
export type QuestionKind = "item" | "review" | "chat";

/** Open questions the assistant itself may have in the queue at once, so a chatty model cannot flood it. */
const MAX_OPEN_CHAT_QUESTIONS = 10;

/** Closed by the reader or the pipeline, and so reopenable. `answered` is not: edit by answering again. */
const REOPENABLE = ["dismissed", "resolved", "merged"];

export class QuestionError extends HttpError {
  constructor(readonly kind: "not_found" | "conflict" | "invalid", message: string) {
    super(message, kind === "not_found" ? 404 : kind === "invalid" ? 400 : 409);
  }
}

/** Something a run or the weekly review would like to ask, before the reconcile call has seen it. */
export interface Candidate {
  kind: QuestionKind;
  question: string;
  source: QuestionSource | null;
}

export async function listOpen(): Promise<Question[]> {
  return db.select().from(questions).where(eq(questions.status, "open")).orderBy(questions.createdAt);
}

export const QUESTION_STATUSES = ["open", "answered", "dismissed", "resolved", "merged"] as const;
export const QUESTION_KINDS = ["item", "review", "chat"] as const;

export interface ListQuestionsOptions {
  /** One status, or `all`. Default `open`. */
  status?: string;
  kind?: string;
  /** Substring match on the question or its answer. */
  query?: string;
  /** Default 100, max 200. */
  limit?: number;
}

/** `listOpen` with filters, for a caller that also wants closed or answered questions. Oldest first. */
export async function listQuestions(opts: ListQuestionsOptions = {}): Promise<Question[]> {
  const status = (opts.status ?? "open").trim().toLowerCase();
  if (status !== "all" && !(QUESTION_STATUSES as readonly string[]).includes(status)) {
    throw new QuestionError("invalid", `status must be one of ${[...QUESTION_STATUSES, "all"].join(", ")}`);
  }
  const kind = opts.kind?.trim().toLowerCase();
  if (kind && !(QUESTION_KINDS as readonly string[]).includes(kind)) {
    throw new QuestionError("invalid", `kind must be one of ${QUESTION_KINDS.join(", ")}`);
  }

  const filters = [];
  if (status !== "all") filters.push(eq(questions.status, status));
  if (kind) filters.push(eq(questions.kind, kind));
  const text = opts.query?.trim();
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(sql`(${questions.question} ILIKE ${like} OR coalesce(${questions.answer}, '') ILIKE ${like})`);
  }

  return db
    .select()
    .from(questions)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(questions.createdAt)
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 200));
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * A question the assistant raises mid-conversation because it found something only the reader can
 * settle. Goes into the same queue as the pipeline's: an identical open question is returned
 * instead of asked twice, and the reconcile call tidies near-duplicates on the next run.
 */
export async function createChatQuestion(
  text: string,
  why: string | null,
  conversationId: string | null,
): Promise<{ question: Question; duplicate: boolean }> {
  const wording = text.trim();
  if (!wording) throw new QuestionError("invalid", "The question is empty");

  const open = await listOpen();
  const same = open.find((q) => normaliseText(q.question) === normaliseText(wording));
  if (same) return { question: same, duplicate: true };
  if (open.filter((q) => q.kind === "chat").length >= MAX_OPEN_CHAT_QUESTIONS) {
    throw new QuestionError("conflict", `There are already ${MAX_OPEN_CHAT_QUESTIONS} open questions from the assistant; ask the user to answer some first`);
  }

  const today = utcDay();
  const [row] = await db
    .insert(questions)
    .values({ kind: "chat", question: wording, sources: [], firstAsked: today, lastAsked: today })
    .returning();
  await logEvent(db, row!.id, "asked", why?.trim() || null, { by: "chat", conversation_id: conversationId });
  return { question: row!, duplicate: false };
}

/** Why a question was asked, from its "asked" event: the assistant's note on what it saw. */
export async function askedReason(id: string): Promise<string | null> {
  const [row] = await db
    .select({ reason: questionEvents.reason })
    .from(questionEvents)
    .where(and(eq(questionEvents.questionId, id), eq(questionEvents.event, "asked")))
    .limit(1);
  return row?.reason ?? null;
}

/** Records how acting on an answer went (`process-answer.ts`). */
export async function setAnswerOutcome(
  id: string,
  status: "running" | "done" | "failed",
  outcome: string | null,
  conversationId?: string | null,
): Promise<void> {
  await db
    .update(questions)
    .set({
      answerStatus: status,
      answerOutcome: outcome,
      ...(conversationId ? { answerConversationId: conversationId } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(questions.id, id));
}

export async function getAnsweredQuestion(id: string): Promise<Question> {
  const row = await getQuestion(id);
  if (row.status !== "answered") throw new QuestionError("conflict", `This question is ${row.status}, not answered`);
  return row;
}

/** Answers given in the last `days`, oldest first: what the reader has already told the system. */
export async function listRecentlyAnswered(days: number): Promise<Question[]> {
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.status, "answered"), gte(questions.answeredAt, sql`now() - make_interval(days => ${days})`)))
    .orderBy(questions.answeredAt);
}

/** Every extraction any question already carries, so a re-run of the same date asks nothing twice. */
export async function askedExtractionIds(): Promise<Set<string>> {
  const rows = await db.select({ sources: questions.sources }).from(questions).where(eq(questions.kind, "item"));
  return new Set(rows.flatMap((r) => r.sources.flatMap((s) => (s.extraction_id ? [s.extraction_id] : []))));
}

async function getQuestion(id: string): Promise<Question> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!row) throw new QuestionError("not_found", "Question not found");
  return row;
}

/**
 * Moves a question out of one of the statuses in `from`, logging `event` if it did. Returns null
 * when the row was not in one of them, so the caller can say why.
 */
async function transitionQuestion(
  id: string,
  from: string[],
  patch: Partial<typeof questions.$inferInsert>,
  event: string,
  reason: string | null = null,
): Promise<Question | null> {
  const [updated] = await db
    .update(questions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), inArray(questions.status, from)))
    .returning();
  if (updated) await logEvent(db, id, event, reason);
  return updated ?? null;
}

/**
 * Records an answer. An item question about one sender also teaches the sender directory
 * (`teach-contact.ts`).
 */
export async function answerQuestion(id: string, answer: string): Promise<Question> {
  const text = answer.trim();
  if (!text) throw new QuestionError("invalid", "The answer is empty");
  const row = await getQuestion(id);
  if (row.status !== "open") throw new QuestionError("conflict", `This question is already ${row.status}`);

  const updated = await transitionQuestion(id, ["open"], { status: "answered", answer: text, answeredAt: new Date().toISOString() }, "answered");
  if (!updated) throw new QuestionError("conflict", "This question was closed in the meantime");

  const senders = [...new Set(updated.sources.map((s) => s.from.toLowerCase()))];
  if (updated.kind === "item" && senders.length === 1 && senders[0]!.includes("@")) {
    await teachContact(senders[0]!, text, updated.sources[0]!.run_date);
  }
  return updated;
}

export async function dismissQuestion(id: string): Promise<Question> {
  const reason = "Dismissed by the reader.";
  const updated = await transitionQuestion(id, ["open"], { status: "dismissed", statusDetail: reason }, "dismissed", reason);
  if (updated) return updated;
  throw new QuestionError("conflict", `This question is already ${(await getQuestion(id)).status}`);
}

/**
 * Puts a closed question back in the queue. A merged one only returns if the question it went into
 * is not open any more; otherwise that one is where to answer it, and reopening would re-create
 * the duplicate the merge removed.
 */
export async function reopenQuestion(id: string): Promise<Question> {
  const row = await getQuestion(id);
  if (!REOPENABLE.includes(row.status)) throw new QuestionError("conflict", `An ${row.status} question cannot be reopened`);
  if (row.status === "merged" && row.mergedInto) {
    const target = await getQuestion(row.mergedInto).catch(() => null);
    if (target?.status === "open") throw new QuestionError("conflict", "It was merged into a question that is still open");
  }
  const updated = await transitionQuestion(id, REOPENABLE, { status: "open", statusDetail: null, mergedInto: null }, "reopened");
  if (!updated) throw new QuestionError("conflict", "This question changed in the meantime");
  return updated;
}

export async function unabsorbedReviewAnswers(): Promise<Question[]> {
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.kind, "review"), eq(questions.status, "answered"), isNull(questions.absorbedAt)))
    .orderBy(questions.answeredAt);
}

export async function markAbsorbed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(questions).set({ absorbedAt: sql`now()` }).where(inArray(questions.id, ids));
}
