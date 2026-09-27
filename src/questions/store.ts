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
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { contacts, db, questions, type QuestionRevision, type QuestionSource } from "../db";

export type Question = typeof questions.$inferSelect;
export type QuestionKind = "item" | "review";

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

function revision(question: string, reason: string | null): QuestionRevision {
  return { question, at: new Date().toISOString(), by: "model", reason };
}

function sourcesOf(candidates: Candidate[]): QuestionSource[] {
  return candidates.flatMap((c) => (c.source ? [c.source] : []));
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
    }

    for (const r of plan.resolves) {
      if (!open.has(r.id)) continue;
      await tx
        .update(questions)
        .set({ status: "resolved", statusDetail: r.reason, updatedAt: now })
        .where(and(eq(questions.id, r.id), eq(questions.status, "open")));
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
      touched.add(id);
    }

    for (const c of plan.created) {
      const [row] = await tx
        .insert(questions)
        .values({ kind: c.kind, question: c.question, sources: sourcesOf(c.candidates), firstAsked: today, lastAsked: today })
        .returning({ id: questions.id });
      touched.add(row!.id);
    }

    // Kept, not skipped: "the assistant decided not to ask this" is itself worth being able to see.
    for (const d of plan.dropped) {
      await tx.insert(questions).values({
        kind: d.candidate.kind,
        question: d.candidate.question,
        status: "resolved",
        statusDetail: d.reason,
        sources: sourcesOf([d.candidate]),
        firstAsked: today,
        lastAsked: today,
      });
    }

    return [...touched];
  });
}

/** Marks the questions a run's Section 2 is waiting for, so the page can say so. */
export async function setBlocking(ids: string[], until: Date | null): Promise<void> {
  if (ids.length === 0) return;
  await db.update(questions).set({ blocksUntil: until?.toISOString() ?? null }).where(inArray(questions.id, ids));
}

export async function stillOpen(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(inArray(questions.id, ids), eq(questions.status, "open")));
  return rows.map((r) => r.id);
}

async function getQuestion(id: string): Promise<Question> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!row) throw new QuestionError("not_found", "Question not found");
  return row;
}

/**
 * Records an answer. An item question about one sender also teaches the sender directory, which
 * is what keeps the classifier from asking about that address again. A row a correction has
 * locked is left alone: the reader's correction outranks a quick answer.
 */
export async function answerQuestion(id: string, answer: string): Promise<Question> {
  const text = answer.trim();
  if (!text) throw new QuestionError("invalid", "The answer is empty");
  const row = await getQuestion(id);
  if (row.status !== "open") throw new QuestionError("conflict", `This question is already ${row.status}`);

  const [updated] = await db
    .update(questions)
    .set({ status: "answered", answer: text, answeredAt: new Date().toISOString(), blocksUntil: null, updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning();
  if (!updated) throw new QuestionError("conflict", "This question was closed in the meantime");

  const senders = [...new Set(updated.sources.map((s) => s.from.toLowerCase()))];
  if (updated.kind === "item" && senders.length === 1 && senders[0]!.includes("@")) {
    await db
      .insert(contacts)
      .values({ identifier: senders[0]!, relationship: text, firstSeen: updated.sources[0]!.run_date })
      .onConflictDoUpdate({
        target: contacts.identifier,
        set: { relationship: text, updatedAt: sql`now()` },
        setWhere: sql`${contacts.locked} IS NOT TRUE`,
      });
  }
  return updated;
}

export async function dismissQuestion(id: string): Promise<Question> {
  const [updated] = await db
    .update(questions)
    .set({ status: "dismissed", statusDetail: "Dismissed by the reader.", blocksUntil: null, updatedAt: sql`now()` })
    .where(and(eq(questions.id, id), eq(questions.status, "open")))
    .returning();
  if (updated) return updated;
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
