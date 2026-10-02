/**
 * The only writer of `questions`.
 *
 * Two parties write the queue and neither may undo the other. The pipeline adds, rephrases,
 * merges and closes open questions through `applyPlan`, which the reconcile call decides
 * (`reconcile.ts`); the reader answers, dismisses and reopens them from `/questions`, through the
 * bridge. Every pipeline write is guarded on `status = 'open'`, so a question answered while the
 * reconcile call was still thinking keeps its answer and its wording.
 *
 * Nothing is deleted. A closed question keeps its status and the reason, and a rephrased one keeps
 * each earlier wording on `history`, so the page can say what changed and a wrong close can be
 * reopened.
 *
 * Every write here also appends to `question_events`, an append-only outcome log: `questions`
 * itself only ever holds the current status and its reason, so a question asked three times then
 * merged loses every earlier reason the moment the next thing happens to it. The log is what lets
 * the reconcile step's merge/resolve/drop calls be judged against real history instead of guessed.
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { contacts, db, questionEvents, questions, type QuestionRevision, type QuestionSource } from "../db";
import { activePrompt } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";

export type Question = typeof questions.$inferSelect;
export type QuestionKind = "item" | "review" | "chat";

/** Open questions the assistant itself may have in the queue at once, so a chatty model cannot flood it. */
const MAX_OPEN_CHAT_QUESTIONS = 10;

/** Closed by the reader or the pipeline, and so reopenable. `answered` is not: edit by answering again. */
const REOPENABLE = ["dismissed", "resolved", "merged"];

export class QuestionError extends Error {
  constructor(readonly kind: "not_found" | "conflict" | "invalid", message: string) {
    super(message);
  }
}

/** Something a run or the weekly review would like to ask, before the reconcile call has seen it. */
export interface Candidate {
  kind: QuestionKind;
  question: string;
  source: QuestionSource | null;
}

/** What the reconcile call decided, already checked against the queue (`reconcile.ts`). */
export interface QueuePlan {
  rewrites: { id: string; question: string; reason: string }[];
  resolves: { id: string; reason: string }[];
  merges: { id: string; into: string; reason: string }[];
  attaches: { candidate: Candidate; to: string }[];
  created: { kind: QuestionKind; question: string; candidates: Candidate[] }[];
  dropped: { candidate: Candidate; reason: string }[];
}

export async function listOpen(): Promise<Question[]> {
  return db.select().from(questions).where(eq(questions.status, "open")).orderBy(questions.createdAt);
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

  const today = new Date().toISOString().split("T")[0]!;
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

interface AnswerClassification {
  /** "" when the answer gives no standing relationship to record. */
  relationship: string;
  spam_or_irrelevant: boolean;
}

const ANSWER_CLASSIFICATION_SCHEMA = {
  name: "answer_classification",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relationship", "spam_or_irrelevant"],
    properties: {
      relationship: { type: "string" },
      spam_or_irrelevant: { type: "boolean" },
    },
  },
};

function revision(question: string, reason: string | null): QuestionRevision {
  return { question, at: new Date().toISOString(), by: "model", reason };
}

function sourcesOf(candidates: Candidate[]): QuestionSource[] {
  return candidates.flatMap((c) => (c.source ? [c.source] : []));
}

/** Only the method the outcome log needs, so it takes either `db` or a transaction inside it. */
type DbLike = Pick<typeof db, "insert">;

/**
 * Appends one row to the outcome log. Never throws: a logging failure must not lose the answer,
 * merge or resolve it is explaining, only be missing from the log of it. Always awaited, though -
 * inside `applyPlan`'s transaction, a fire-and-forget insert would run concurrently with the next
 * statement on the same connection.
 */
async function logEvent(
  exec: DbLike,
  questionId: string,
  event: string,
  reason: string | null = null,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await exec.insert(questionEvents).values({ questionId, event, reason, detail: detail ?? null });
  } catch (err) {
    console.error(`[questions] Failed to log ${event} for ${questionId}:`, err);
  }
}

/**
 * Applies a plan in one transaction. Returns the ids of the open questions that took one of this
 * run's candidates: those are what the run's Section 2 waits for.
 */
export async function applyPlan(plan: QueuePlan, today: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    const open = new Map(
      (await tx.select().from(questions).where(eq(questions.status, "open"))).map((q) => [q.id, q]),
    );
    const now = new Date().toISOString();
    const touched = new Set<string>();

    for (const r of plan.rewrites) {
      const row = open.get(r.id);
      if (!row || row.question === r.question) continue;
      row.history = [...row.history, revision(row.question, r.reason)];
      row.question = r.question;
      await tx
        .update(questions)
        .set({ question: row.question, history: row.history, updatedAt: now })
        .where(and(eq(questions.id, r.id), eq(questions.status, "open")));
      await logEvent(tx, r.id, "rewritten", r.reason);
    }

    for (const r of plan.resolves) {
      if (!open.has(r.id)) continue;
      await tx
        .update(questions)
        .set({ status: "resolved", statusDetail: r.reason, updatedAt: now })
        .where(and(eq(questions.id, r.id), eq(questions.status, "open")));
      await logEvent(tx, r.id, "resolved", r.reason);
      open.delete(r.id);
    }

    for (const m of plan.merges) {
      const row = open.get(m.id);
      const target = open.get(m.into);
      if (!row || !target) continue;
      // The target inherits the mails and the count, so "asked 4 times" stays true after a merge.
      target.sources = [...target.sources, ...row.sources];
      target.timesAsked += row.timesAsked;
      target.firstAsked = row.firstAsked < target.firstAsked ? row.firstAsked : target.firstAsked;
      await tx
        .update(questions)
        .set({ sources: target.sources, timesAsked: target.timesAsked, firstAsked: target.firstAsked, updatedAt: now })
        .where(and(eq(questions.id, target.id), eq(questions.status, "open")));
      await tx
        .update(questions)
        .set({ status: "merged", mergedInto: target.id, statusDetail: m.reason, updatedAt: now })
        .where(and(eq(questions.id, m.id), eq(questions.status, "open")));
      await logEvent(tx, m.id, "merged", m.reason, { merged_into: target.id });
      open.delete(m.id);
    }

    // Grouped, so a question two candidates attach to is asked "once more", not twice more.
    const attachments = new Map<string, Candidate[]>();
    for (const a of plan.attaches) attachments.set(a.to, [...(attachments.get(a.to) ?? []), a.candidate]);
    for (const [id, candidates] of attachments) {
      const row = open.get(id);
      if (!row) continue;
      await tx
        .update(questions)
        .set({
          sources: [...row.sources, ...sourcesOf(candidates)],
          timesAsked: row.lastAsked === today ? row.timesAsked : row.timesAsked + 1,
          lastAsked: today,
          updatedAt: now,
        })
        .where(and(eq(questions.id, id), eq(questions.status, "open")));
      await logEvent(tx, id, "reasked", null, { candidates: candidates.length });
      touched.add(id);
    }

    for (const c of plan.created) {
      const [row] = await tx
        .insert(questions)
        .values({ kind: c.kind, question: c.question, sources: sourcesOf(c.candidates), firstAsked: today, lastAsked: today })
        .returning({ id: questions.id });
      await logEvent(tx, row!.id, "asked");
      touched.add(row!.id);
    }

    // Kept, not skipped: "the assistant decided not to ask this" is itself worth being able to see.
    for (const d of plan.dropped) {
      const [row] = await tx
        .insert(questions)
        .values({
          kind: d.candidate.kind,
          question: d.candidate.question,
          status: "resolved",
          statusDetail: d.reason,
          sources: sourcesOf([d.candidate]),
          firstAsked: today,
          lastAsked: today,
        })
        .returning({ id: questions.id });
      await logEvent(tx, row!.id, "dropped", d.reason);
    }

    return [...touched];
  });
}

async function getQuestion(id: string): Promise<Question> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!row) throw new QuestionError("not_found", "Question not found");
  return row;
}

/**
 * Records an answer. An item question about one sender also teaches the sender directory - but
 * only the standing relationship the answer actually gives, never the answer text verbatim, so
 * "no idea, looks like spam" cannot become that sender's permanent description. A row a
 * correction has locked is left alone: the reader's correction outranks a quick answer. A
 * classification failure never loses the answer itself: it is already recorded by the time that
 * call runs.
 */
export async function answerQuestion(id: string, answer: string): Promise<Question> {
  const text = answer.trim();
  if (!text) throw new QuestionError("invalid", "The answer is empty");
  const row = await getQuestion(id);
  if (row.status !== "open") throw new QuestionError("conflict", `This question is already ${row.status}`);

  const [updated] = await db
    .update(questions)
    .set({ status: "answered", answer: text, answeredAt: new Date().toISOString(), updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning();
  if (!updated) throw new QuestionError("conflict", "This question was closed in the meantime");
  await logEvent(db, id, "answered");

  const senders = [...new Set(updated.sources.map((s) => s.from.toLowerCase()))];
  if (updated.kind === "item" && senders.length === 1 && senders[0]!.includes("@")) {
    await teachContact(senders[0]!, text, updated.sources[0]!.run_date);
  }
  return updated;
}

async function teachContact(identifier: string, answer: string, firstSeen: string): Promise<void> {
  let classification: AnswerClassification;
  try {
    const prompt = await activePrompt("answer_classification");
    classification = await extractJson<AnswerClassification>(prompt.text, answer, {
      schema: ANSWER_CLASSIFICATION_SCHEMA,
      reasoningEffort: "low",
    });
  } catch (err) {
    console.error(`[questions] Answer classification failed for ${identifier}, leaving contacts untouched:`, err);
    return;
  }

  const relationship = classification.relationship.trim();
  if (classification.spam_or_irrelevant || !relationship) return;

  await db
    .insert(contacts)
    .values({ identifier, relationship, firstSeen })
    .onConflictDoUpdate({
      target: contacts.identifier,
      set: { relationship, updatedAt: sql`now()` },
      setWhere: sql`${contacts.locked} IS NOT TRUE`,
    });
}

export async function dismissQuestion(id: string): Promise<Question> {
  const [updated] = await db
    .update(questions)
    .set({ status: "dismissed", statusDetail: "Dismissed by the reader.", updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning();
  if (updated) {
    await logEvent(db, id, "dismissed", "Dismissed by the reader.");
    return updated;
  }
  const row = await getQuestion(id);
  throw new QuestionError("conflict", `This question is already ${row.status}`);
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
  const [updated] = await db
    .update(questions)
    .set({ status: "open", statusDetail: null, mergedInto: null, updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), inArray(questions.status, REOPENABLE)))
    .returning();
  if (!updated) throw new QuestionError("conflict", "This question changed in the meantime");
  await logEvent(db, id, "reopened");
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
