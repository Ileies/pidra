// src/questions/plan.ts, the pure half of the queue reconcile: how the model's answer about the question queue becomes
// a plan code applies. Model proposes, code decides: an id that maps to nothing, a merge into a
// question that does not stay open, a missing reason all fall back to the safe choice (ask the
// candidate, keep the question), so the worst case is a repeat, never a lost question.
import { describe, expect, test } from "bun:test";
import { buildPlan, capCreated, emptyPlan, mechanicalPlan } from "../src/questions/plan";

type Question = import("../src/questions/store").Question;
type Candidate = import("../src/questions/store").Candidate;
type Answer = Parameters<typeof buildPlan>[0];
type QuestionSource = import("../src/db/schema").QuestionSource;

const source = (from: string, subject = "Hello"): QuestionSource => ({ extraction_id: null, from, subject, source_type: "email", run_date: "2026-10-05" });

let n = 0;
function question(over: Partial<Question> = {}): Question {
  const id = over.id ?? `uuid-${++n}`;
  return { id, kind: "item", question: `Question ${id}?`, sources: [], ...over } as Question;
}
function candidate(over: Partial<Candidate> = {}): Candidate {
  return { kind: "item", question: `Candidate ${++n}?`, source: source("sender@example.com"), ...over };
}

const answer = (over: Partial<Answer> = {}): Answer => ({ existing: [], candidates: [], new_questions: [], ...over });
const existing = (id: string, action: Answer["existing"][number]["action"], over: Partial<Answer["existing"][number]> = {}): Answer["existing"][number] => ({ id, action, question: "", into: "", reason: "", ...over });
const decision = (id: string, action: Answer["candidates"][number]["action"], over: Partial<Answer["candidates"][number]> = {}): Answer["candidates"][number] => ({ id, action, target: "", reason: "", ...over });

/** The queue as the model sees it: q1, q2 ... and c1, c2 ... */
function world(open: Question[], cands: Candidate[]) {
  return {
    open: new Map(open.map((q, i) => [`q${i + 1}`, q])),
    cands: new Map(cands.map((c, i) => [`c${i + 1}`, c])),
  };
}

describe("emptyPlan and capCreated", () => {
  test("an empty plan changes nothing", () => {
    expect(emptyPlan()).toEqual({ rewrites: [], resolves: [], merges: [], attaches: [], created: [], dropped: [] });
  });

  test("at most three new questions a run, the first three kept and nothing else touched", () => {
    const plan = { ...emptyPlan(), dropped: [{ candidate: candidate(), reason: "r" }], created: Array.from({ length: 5 }, (_, i) => ({ kind: "item" as const, question: `New ${i}`, candidates: [candidate()] })) };
    const capped = capCreated(plan);
    expect(capped.created.map((c) => c.question)).toEqual(["New 0", "New 1", "New 2"]);
    expect(capped.dropped).toEqual(plan.dropped);
    expect(capCreated(plan, 1).created).toHaveLength(1);
    expect(capCreated(plan, 5)).toBe(plan);
    expect(capCreated(emptyPlan())).toEqual(emptyPlan());
  });
});

describe("mechanicalPlan", () => {
  test("attaches an item candidate to the open item question about the same single sender", () => {
    const q = question({ sources: [source("Bank@Example.com")] });
    const c = candidate({ source: source("bank@example.com") });
    const plan = mechanicalPlan([c], [q]);
    expect(plan.attaches).toEqual([{ candidate: c, to: q.id }]);
    expect(plan.created).toEqual([]);
  });

  test("an open question about several senders is not an attach target", () => {
    const q = question({ sources: [source("a@example.com"), source("b@example.com")] });
    const c = candidate({ source: source("a@example.com") });
    const plan = mechanicalPlan([c], [q]);
    expect(plan.attaches).toEqual([]);
    expect(plan.created).toHaveLength(1);
  });

  test("only item questions attach: a review or chat question about the sender is left alone", () => {
    const q = question({ kind: "review", sources: [source("a@example.com")] });
    expect(mechanicalPlan([candidate({ source: source("a@example.com") })], [q]).attaches).toEqual([]);
  });

  test("candidates from one sender are asked once, as a group", () => {
    const [one, two] = [candidate({ source: source("shop@example.com"), question: "First?" }), candidate({ source: source("Shop@example.com"), question: "Second?" })];
    const plan = mechanicalPlan([one, two], []);
    expect(plan.created).toEqual([{ kind: "item", question: "First?", candidates: [one, two] }]);
  });

  test("candidates without a sender group by their text, case aside, and the rest stay apart", () => {
    const a = candidate({ kind: "review", source: null, question: "Is this still true?" });
    const b = candidate({ kind: "review", source: null, question: "is this STILL true?" });
    const c = candidate({ kind: "review", source: null, question: "Something else?" });
    const plan = mechanicalPlan([a, b, c], []);
    expect(plan.created.map((g) => g.candidates.length)).toEqual([2, 1]);
  });

  test("no open questions and no candidates is an empty plan", () => {
    expect(mechanicalPlan([], [])).toEqual(emptyPlan());
  });
});

describe("buildPlan: open questions", () => {
  test("an open question the model says nothing about is kept, and unknown ids are ignored", () => {
    const { open, cands } = world([question(), question()], []);
    const plan = buildPlan(answer({ existing: [existing("q9", "resolve", { reason: "x" })] }), open, cands);
    expect(plan).toEqual(emptyPlan());
  });

  test("a rewrite carries the new text and a reason, both trimmed to one line and capped", () => {
    const { open, cands } = world([question({ id: "uuid-a" })], []);
    const long = "x".repeat(500);
    const plan = buildPlan(answer({ existing: [existing("q1", "rewrite", { question: `  Is  it\n ${long}`, reason: "" })] }), open, cands);
    expect(plan.rewrites).toHaveLength(1);
    expect(plan.rewrites[0]!.id).toBe("uuid-a");
    expect(plan.rewrites[0]!.question).toHaveLength(400);
    expect(plan.rewrites[0]!.question).toStartWith("Is it x");
    expect(plan.rewrites[0]!.reason).toBe("Rephrased to cover a related question.");
  });

  test("a rewrite with no text is kept as it was", () => {
    const { open, cands } = world([question()], []);
    expect(buildPlan(answer({ existing: [existing("q1", "rewrite", { question: "   " })] }), open, cands).rewrites).toEqual([]);
  });

  test("a resolve carries the model's reason, or a default one", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b" })], []);
    const plan = buildPlan(answer({ existing: [existing("q1", "resolve", { reason: "A note says so" }), existing("q2", "resolve")] }), open, cands);
    expect(plan.resolves).toEqual([
      { id: "uuid-a", reason: "A note says so" },
      { id: "uuid-b", reason: "Settled by newer context." },
    ]);
  });

  test("the first decision for an id wins, and the model's id is trimmed", () => {
    const { open, cands } = world([question({ id: "uuid-a" })], []);
    const plan = buildPlan(answer({ existing: [existing(" q1 ", "resolve", { reason: "first" }), existing("q1", "rewrite", { question: "later" })] }), open, cands);
    expect(plan.resolves).toEqual([{ id: "uuid-a", reason: "first" }]);
    expect(plan.rewrites).toEqual([]);
  });

  test("a merge goes into a different open question of the same kind that stays open", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b" })], []);
    const plan = buildPlan(answer({ existing: [existing("q1", "merge", { into: "q2", reason: "same" })] }), open, cands);
    expect(plan.merges).toEqual([{ id: "uuid-a", into: "uuid-b", reason: "same" }]);
  });

  test("a merge into itself, into an unknown id, or across kinds is refused and the question stays", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b", kind: "review" })], []);
    const plan = buildPlan(
      answer({ existing: [existing("q1", "merge", { into: "q1" }), existing("q2", "merge", { into: "q7" })] }),
      open,
      cands,
    );
    expect(plan.merges).toEqual([]);
    const across = buildPlan(answer({ existing: [existing("q1", "merge", { into: "q2" })] }), open, cands);
    expect(across.merges).toEqual([]);
  });

  test("a merge into a question that is itself resolved or merged away is refused", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b" }), question({ id: "uuid-c" })], []);
    const intoResolved = buildPlan(answer({ existing: [existing("q2", "resolve", { reason: "done" }), existing("q1", "merge", { into: "q2" })] }), open, cands);
    expect(intoResolved.merges).toEqual([]);
    expect(intoResolved.resolves).toHaveLength(1);

    const chain = buildPlan(answer({ existing: [existing("q2", "merge", { into: "q3" }), existing("q1", "merge", { into: "q2" })] }), open, cands);
    expect(chain.merges).toEqual([{ id: "uuid-b", into: "uuid-c", reason: "Asks the same as another open question." }]);
  });

  test("a merge into a question that is being rewritten is allowed", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b" })], []);
    const plan = buildPlan(answer({ existing: [existing("q2", "rewrite", { question: "Combined?" }), existing("q1", "merge", { into: "q2" })] }), open, cands);
    expect(plan.merges).toHaveLength(1);
    expect(plan.rewrites).toHaveLength(1);
  });
});

describe("buildPlan: candidates", () => {
  test("a candidate the model does not mention is asked as it stands", () => {
    const c = candidate();
    const { open, cands } = world([], [c]);
    expect(buildPlan(answer(), open, cands).created).toEqual([{ kind: c.kind, question: c.question, candidates: [c] }]);
  });

  test("an id that maps to no candidate is ignored, and a repeated id counts once", () => {
    const c = candidate();
    const { open, cands } = world([], [c]);
    const plan = buildPlan(answer({ candidates: [decision("c9", "drop", { reason: "x" }), decision("c1", "drop", { reason: "first" }), decision("c1", "drop", { reason: "second" })] }), open, cands);
    expect(plan.dropped).toEqual([{ candidate: c, reason: "first" }]);
    expect(plan.created).toEqual([]);
  });

  test("a drop needs a reason; without one the candidate is asked", () => {
    const [a, b] = [candidate(), candidate()];
    const { open, cands } = world([], [a, b]);
    const plan = buildPlan(answer({ candidates: [decision("c1", "drop", { reason: "  already answered  " }), decision("c2", "drop", { reason: "   " })] }), open, cands);
    expect(plan.dropped).toEqual([{ candidate: a, reason: "already answered" }]);
    expect(plan.created.map((g) => g.candidates[0])).toEqual([b]);
  });

  test("an attach goes to the named open question of the same kind", () => {
    const q = question({ id: "uuid-a" });
    const c = candidate();
    const { open, cands } = world([q], [c]);
    expect(buildPlan(answer({ candidates: [decision("c1", "attach", { target: "q1" })] }), open, cands).attaches).toEqual([{ candidate: c, to: "uuid-a" }]);
  });

  test("an attach to an unknown question, or one of another kind, is asked instead", () => {
    const c = candidate({ kind: "item" });
    const { open, cands } = world([question({ kind: "review" })], [c]);
    for (const target of ["q1", "q5", ""]) {
      const plan = buildPlan(answer({ candidates: [decision("c1", "attach", { target })] }), open, cands);
      expect(plan.attaches).toEqual([]);
      expect(plan.created).toHaveLength(1);
    }
  });

  test("an attach to a question that was merged away follows it to the survivor", () => {
    const { open, cands } = world([question({ id: "uuid-a" }), question({ id: "uuid-b" })], [candidate()]);
    const plan = buildPlan(answer({ existing: [existing("q1", "merge", { into: "q2" })], candidates: [decision("c1", "attach", { target: "q1" })] }), open, cands);
    expect(plan.attaches).toEqual([{ candidate: expect.anything(), to: "uuid-b" }]);
  });

  test("an attach to a question the plan resolves is dropped with that reason, not added to a closed question", () => {
    const c = candidate();
    const { open, cands } = world([question({ id: "uuid-a" })], [c]);
    const plan = buildPlan(answer({ existing: [existing("q1", "resolve", { reason: "A note settled it" })], candidates: [decision("c1", "attach", { target: "q1" })] }), open, cands);
    expect(plan.attaches).toEqual([]);
    expect(plan.dropped).toEqual([{ candidate: c, reason: "Already settled: A note settled it" }]);
  });

  test("an ask uses the model's new question, grouping candidates that point at the same one", () => {
    const [a, b, c] = [candidate(), candidate(), candidate({ kind: "review" })];
    const { open, cands } = world([], [a, b, c]);
    const plan = buildPlan(
      answer({
        new_questions: [{ id: "n1", question: "  Who is this sender?  " }],
        candidates: [decision("c1", "ask", { target: "n1" }), decision("c2", "ask", { target: "n1" }), decision("c3", "ask", { target: "n1" })],
      }),
      open,
      cands,
    );
    expect(plan.created).toEqual([
      { kind: "item", question: "Who is this sender?", candidates: [a, b] },
      { kind: "review", question: "Who is this sender?", candidates: [c] },
    ]);
  });

  test("an ask pointing at a missing or empty new question is asked as it stands", () => {
    const [a, b] = [candidate({ question: "Mine A?" }), candidate({ question: "Mine B?" })];
    const { open, cands } = world([], [a, b]);
    const plan = buildPlan(
      answer({ new_questions: [{ id: "n1", question: "   " }], candidates: [decision("c1", "ask", { target: "n1" }), decision("c2", "ask", { target: "n7" })] }),
      open,
      cands,
    );
    expect(plan.created.map((g) => [g.question, g.candidates.length])).toEqual([["Mine A?", 1], ["Mine B?", 1]]);
  });

  test("every candidate ends up in exactly one place", () => {
    const cs = [candidate(), candidate(), candidate(), candidate(), candidate()];
    const { open, cands } = world([question()], cs);
    const plan = buildPlan(
      answer({
        new_questions: [{ id: "n1", question: "New?" }],
        candidates: [
          decision("c1", "drop", { reason: "dup" }),
          decision("c2", "attach", { target: "q1" }),
          decision("c3", "ask", { target: "n1" }),
          decision("c4", "attach", { target: "q9" }),
        ],
      }),
      open,
      cands,
    );
    const placed = [...plan.dropped.map((d) => d.candidate), ...plan.attaches.map((a) => a.candidate), ...plan.created.flatMap((g) => g.candidates)];
    expect(placed).toHaveLength(5);
    expect(new Set(placed)).toEqual(new Set(cs));
  });
});
