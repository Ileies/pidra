/**
 * The pure half of the question queue reconcile (`reconcile.ts` makes the call): turns the model's
 * answer, or no answer at all, into a `QueuePlan` that `apply-plan.ts` writes.
 * Model proposes, code decides (same split as quick actions):
 * - The model sees short ids ("q1", "c1", "n1"); an id that maps to nothing falls back to the safe choice.
 * - Fails open: a skipped/reasonless/unusable decision means the candidate is asked as it stands and
 *   an open question is kept. Worst case is a duplicate, never a lost question.
 * - Every close carries its reason onto the row. If the call itself fails, `mechanicalPlan` is the fallback.
 */
import { squash } from "../util/text";
import type { QueuePlan } from "./apply-plan";
import type { Candidate, Question } from "./store";

const MAX_QUESTION_CHARS = 400;
const MAX_REASON_CHARS = 300;
/** Cap on brand-new questions per run (11 landed in one night on 2026-10-01). Excess candidates stay out of the plan, so the next run reconsiders them. */
const MAX_NEW_QUESTIONS_PER_RUN = 3;

export interface ModelAnswer {
  existing: { id: string; action: "keep" | "rewrite" | "resolve" | "merge"; question: string; into: string; reason: string }[];
  candidates: { id: string; action: "ask" | "attach" | "drop"; target: string; reason: string }[];
  new_questions: { id: string; question: string }[];
}

export function emptyPlan(): QueuePlan {
  return { rewrites: [], resolves: [], merges: [], attaches: [], created: [], dropped: [] };
}

/** Enforces `MAX_NEW_QUESTIONS_PER_RUN`; excess groups vanish from the plan (not dropped), so they reappear next run. */
export function capCreated(plan: QueuePlan, max = MAX_NEW_QUESTIONS_PER_RUN): QueuePlan {
  return plan.created.length <= max ? plan : { ...plan, created: plan.created.slice(0, max) };
}

/**
 * The fallback when the call fails: attach a mail question to an open one about the same single
 * sender, and ask the rest as they stand. Deliberately dumb, so it cannot be wrong in a new way.
 */
export function mechanicalPlan(candidates: Candidate[], open: Question[]): QueuePlan {
  const plan = emptyPlan();
  const bySender = new Map<string, string>();
  for (const q of open) {
    const senders = [...new Set(q.sources.map((s) => s.from.toLowerCase()))];
    if (q.kind === "item" && senders.length === 1) bySender.set(senders[0]!, q.id);
  }
  const fresh = new Map<string, QueuePlan["created"][number]>();
  for (const c of candidates) {
    const sender = c.source?.from.toLowerCase();
    const existing = c.kind === "item" && sender ? bySender.get(sender) : undefined;
    if (existing) {
      plan.attaches.push({ candidate: c, to: existing });
      continue;
    }
    const key = c.kind === "item" && sender ? `sender:${sender}` : `text:${c.question.toLowerCase()}`;
    const group = fresh.get(key);
    if (group) group.candidates.push(c);
    else fresh.set(key, { kind: c.kind, question: c.question, candidates: [c] });
  }
  plan.created = [...fresh.values()];
  return plan;
}

/** Turns the model's answer into a plan code can apply, falling back to the safe choice everywhere. */
export function buildPlan(answer: ModelAnswer, open: Map<string, Question>, candidates: Map<string, Candidate>): QueuePlan {
  const plan = emptyPlan();

  // First decision per id wins; an open question with none is kept.
  const decided = new Map<string, ModelAnswer["existing"][number]>();
  for (const d of answer.existing) if (open.has(d.id.trim()) && !decided.has(d.id.trim())) decided.set(d.id.trim(), d);

  const action = (id: string) => decided.get(id)?.action ?? "keep";
  const outcome = new Map<string, { resolved?: string; mergedInto?: string }>();

  for (const [id, d] of decided) {
    const reason = squash(d.reason, MAX_REASON_CHARS);
    if (d.action === "rewrite") {
      const text = squash(d.question, MAX_QUESTION_CHARS);
      if (text) plan.rewrites.push({ id: open.get(id)!.id, question: text, reason: reason || "Rephrased to cover a related question." });
    } else if (d.action === "resolve") {
      const why = reason || "Settled by newer context.";
      plan.resolves.push({ id: open.get(id)!.id, reason: why });
      outcome.set(id, { resolved: why });
    } else if (d.action === "merge") {
      const into = d.into.trim();
      const target = open.get(into);
      // Only into a question that itself stays open and is of the same kind; anything else, keep.
      const ok = target && into !== id && target.kind === open.get(id)!.kind && ["keep", "rewrite"].includes(action(into));
      if (ok) {
        plan.merges.push({ id: open.get(id)!.id, into: target.id, reason: reason || "Asks the same as another open question." });
        outcome.set(id, { mergedInto: into });
      }
    }
  }

  const newTexts = new Map<string, string>();
  for (const n of answer.new_questions) {
    const text = squash(n.question, MAX_QUESTION_CHARS);
    if (text && !newTexts.has(n.id.trim())) newTexts.set(n.id.trim(), text);
  }

  const created = new Map<string, QueuePlan["created"][number]>();
  const askAsIs = (c: Candidate) => plan.created.push({ kind: c.kind, question: c.question, candidates: [c] });

  const seen = new Set<string>();
  for (const d of answer.candidates) {
    const id = d.id.trim();
    const c = candidates.get(id);
    if (!c || seen.has(id)) continue;
    seen.add(id);
    const target = d.target.trim();

    if (d.action === "drop") {
      const reason = squash(d.reason, MAX_REASON_CHARS);
      if (reason) plan.dropped.push({ candidate: c, reason });
      else askAsIs(c);
    } else if (d.action === "attach") {
      const into = outcome.get(target)?.mergedInto ?? target;
      const q = open.get(into);
      const resolved = outcome.get(into)?.resolved;
      if (!q || q.kind !== c.kind) askAsIs(c);
      else if (resolved) plan.dropped.push({ candidate: c, reason: `Already settled: ${resolved}` });
      else plan.attaches.push({ candidate: c, to: q.id });
    } else {
      const text = newTexts.get(target);
      if (!text) {
        askAsIs(c);
        continue;
      }
      const key = `${target}:${c.kind}`;
      const group = created.get(key);
      if (group) group.candidates.push(c);
      else created.set(key, { kind: c.kind, question: text, candidates: [c] });
    }
  }

  plan.created.push(...created.values());
  for (const [id, c] of candidates) if (!seen.has(id)) askAsIs(c);
  return plan;
}
