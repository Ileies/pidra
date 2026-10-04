import { and, eq } from "drizzle-orm";
import { db, questions, type QuestionRevision, type QuestionSource } from "../db";
import { logEvent } from "./events";
import type { Candidate, QuestionKind } from "./store";

/** What the reconcile call decided, already checked against the queue (`reconcile.ts`). */
export interface QueuePlan {
  rewrites: { id: string; question: string; reason: string }[];
  resolves: { id: string; reason: string }[];
  merges: { id: string; into: string; reason: string }[];
  attaches: { candidate: Candidate; to: string }[];
  created: { kind: QuestionKind; question: string; candidates: Candidate[] }[];
  dropped: { candidate: Candidate; reason: string }[];
}

function revision(question: string, reason: string | null): QuestionRevision {
  return { question, at: new Date().toISOString(), by: "model", reason };
}

function sourcesOf(candidates: Candidate[]): QuestionSource[] {
  return candidates.flatMap((c) => (c.source ? [c.source] : []));
}

/**
 * Applies a plan in one transaction. Returns the ids of the open questions that took one of this
 * run's candidates: those are what the run's Section 2 waits for. Every write is guarded on
 * `status = 'open'`, so a question answered while the reconcile call was still thinking keeps its
 * answer and its wording.
 */
export async function applyPlan(plan: QueuePlan, today: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    const open = new Map(
      (await tx.select().from(questions).where(eq(questions.status, "open"))).map((q) => [q.id, q]),
    );
    const now = new Date().toISOString();
    const touched = new Set<string>();
    const stillOpen = (id: string) => and(eq(questions.id, id), eq(questions.status, "open"));

    for (const r of plan.rewrites) {
      const row = open.get(r.id);
      if (!row || row.question === r.question) continue;
      row.history = [...row.history, revision(row.question, r.reason)];
      row.question = r.question;
      await tx.update(questions).set({ question: row.question, history: row.history, updatedAt: now }).where(stillOpen(r.id));
      await logEvent(tx, r.id, "rewritten", r.reason);
    }

    for (const r of plan.resolves) {
      if (!open.has(r.id)) continue;
      await tx.update(questions).set({ status: "resolved", statusDetail: r.reason, updatedAt: now }).where(stillOpen(r.id));
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
        .where(stillOpen(target.id));
      await tx
        .update(questions)
        .set({ status: "merged", mergedInto: target.id, statusDetail: m.reason, updatedAt: now })
        .where(stillOpen(m.id));
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
        .where(stillOpen(id));
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
