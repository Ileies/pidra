// src/questions/reconcile.ts `reconcileQueue` against real SQL: what the model is shown (short ids,
// only the contacts and notes that matter, recent answers) and what comes back as a plan. Only the
// model call and the prompt lookup are mocks.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Call = { prompt: string; input: Record<string, any>; options: Record<string, any> };
const calls: Call[] = [];
let reply: unknown = { existing: [], candidates: [], new_questions: [] };
let fail: Error | null = null;

mock.module("../src/ai/openai", () => ({
  extractJson: async (prompt: string, input: string, options: Record<string, any>) => {
    calls.push({ prompt, input: JSON.parse(input), options });
    if (fail) throw fail;
    options.onUsage?.(120, 30);
    return reply;
  },
  usageTally: () => {
    const tally = { tokensIn: 0, tokensOut: 0, onUsage(i: number, o: number) { tally.tokensIn += i; tally.tokensOut += o; } };
    return tally;
  },
}));
mock.module("../src/ai/active-prompts", () => ({ activePrompt: async () => ({ text: "reconcile the queue", version: 1 }) }));

const database = await useTestDatabase();
const { db, questions, contacts, notes } = await import("../src/db");
const { reconcileQueue } = await import("../src/questions/reconcile");

const TODAY = "2026-10-05";
const noContext = { longTermContext: { corrections: [], intelSections: "", personalSections: "", interestSections: "", generatedAt: null, problem: null } };

beforeEach(async () => {
  calls.length = 0;
  reply = { existing: [], candidates: [], new_questions: [] };
  fail = null;
  await database.sql`truncate questions, contacts, notes cascade`;
});

const source = (from: string) => ({ extraction_id: null, from, subject: "Invoice", source_type: "email", run_date: "2026-10-04" });
const candidate = (question: string, from: string | null = "shop@example.com") => ({ kind: "item" as const, question, source: from ? source(from) : null });

async function open(question: string, from = "shop@example.com") {
  const [row] = await db.insert(questions).values({ kind: "item", question, sources: [source(from)], firstAsked: "2026-10-01", lastAsked: "2026-10-03", timesAsked: 2 }).returning();
  return row!;
}

describe("reconcileQueue", () => {
  test("makes no call and returns an empty plan when there is nothing to reconcile", async () => {
    const result = await reconcileQueue([], TODAY, noContext);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ plan: { rewrites: [], resolves: [], merges: [], attaches: [], created: [], dropped: [] }, openCount: 0, tokensIn: 0, tokensOut: 0, aiCalls: 0 });
  });

  test("still asks when only open questions exist, since a note may have answered one", async () => {
    await open("Who is shop@example.com?");
    const result = await reconcileQueue([], TODAY, noContext);
    expect(calls).toHaveLength(1);
    expect(result.openCount).toBe(1);
    expect(result.aiCalls).toBe(1);
    expect(result.plan.created).toEqual([]);
  });

  test("shows the model short ids for open questions and candidates, and nothing it has no use for", async () => {
    await open("Who is shop@example.com?");
    await open("What is this invoice for?", "billing@example.com");
    await reconcileQueue([candidate("Is this order expected?"), candidate("What is the offer?", null)], TODAY, noContext);

    const { input, options, prompt } = calls[0]!;
    expect(prompt).toBe("reconcile the queue");
    expect(options).toMatchObject({ reasoningEffort: "high", maxOutputTokens: 10000 });
    expect(options.schema.name).toBe("question_queue");
    expect(input.today).toBe(TODAY);
    expect(input.open_questions.map((q: any) => [q.id, q.question, q.times_asked, q.first_asked])).toEqual([
      ["q1", "Who is shop@example.com?", 2, "2026-10-01"],
      ["q2", "What is this invoice for?", 2, "2026-10-01"],
    ]);
    expect(input.open_questions[0].about).toEqual([{ type: "email", from: "shop@example.com", subject: "Invoice", date: "2026-10-04" }]);
    expect(input.candidates.map((c: any) => [c.id, c.about?.from ?? null])).toEqual([["c1", "shop@example.com"], ["c2", null]]);
  });

  test("includes the contacts of the senders involved, skipping removed ones, and the live personal and contact notes only", async () => {
    await open("Who is shop@example.com?");
    await db.insert(contacts).values([
      { identifier: "shop@example.com", name: "The Shop", relationship: "online store", contextNotes: "orders books" },
      { identifier: "gone@example.com", name: "Gone", removedAt: "2026-09-01T00:00:00Z" as never },
      { identifier: "other@example.com", name: "Unrelated" },
    ]);
    await db.insert(notes).values([
      { content: "I only order from the shop in spring", scope: "personal" },
      { content: "Shop is reliable", scope: "contact" },
      { content: "A news interest", scope: "intel" },
      { content: "Deleted note", scope: "personal", deletedAt: "2026-09-20T00:00:00Z" as never },
    ]);
    await reconcileQueue([candidate("Is this order expected?", "gone@example.com")], TODAY, noContext);

    const { input } = calls[0]!;
    expect(input.known_contacts).toEqual([{ identifier: "shop@example.com", name: "The Shop", relationship: "online store", notes: "orders books" }]);
    expect(input.notes.map((n: any) => n.text).sort()).toEqual(["I only order from the shop in spring", "Shop is reliable"]);
  });

  test("includes answers from the last 30 days and the long-term context given", async () => {
    await db.insert(questions).values([
      { kind: "item", question: "Recent?", status: "answered", answer: "Yes, expected", answeredAt: new Date(Date.now() - 5 * 86_400_000).toISOString() as never, sources: [source("shop@example.com")], firstAsked: "2026-09-25", lastAsked: "2026-09-25" },
      { kind: "item", question: "Old?", status: "answered", answer: "Long ago", answeredAt: new Date(Date.now() - 90 * 86_400_000).toISOString() as never, firstAsked: "2026-06-01", lastAsked: "2026-06-01" },
    ]);
    await open("Who is this?");
    const longTermContext = { ...noContext.longTermContext, personalSections: "# 1. Identity\nlives in Zurich" };
    await reconcileQueue([], TODAY, { longTermContext });

    const { input } = calls[0]!;
    expect(input.recently_answered.map((a: any) => [a.question, a.answer, a.about])).toEqual([["Recent?", "Yes, expected", ["shop@example.com"]]]);
    expect(input.long_term_context).toBe("# 1. Identity\nlives in Zurich");
    expect(input.context_corrections).toBeNull();
  });

  test("turns the model's answer into a capped plan and reports the usage", async () => {
    const q = await open("Who is shop@example.com?");
    reply = {
      existing: [{ id: "q1", action: "rewrite", question: "Who runs the shop?", into: "", reason: "clearer" }],
      candidates: [
        { id: "c1", action: "attach", target: "q1", reason: "" },
        { id: "c2", action: "ask", target: "n1", reason: "" },
        { id: "c3", action: "ask", target: "n2", reason: "" },
        { id: "c4", action: "ask", target: "n3", reason: "" },
        { id: "c5", action: "ask", target: "n4", reason: "" },
      ],
      new_questions: [1, 2, 3, 4].map((i) => ({ id: `n${i}`, question: `New question ${i}?` })),
    };
    const result = await reconcileQueue(["a", "b", "c", "d", "e"].map((s) => candidate(`Question ${s}?`)), TODAY, noContext);

    expect(result.plan.rewrites).toEqual([{ id: q.id, question: "Who runs the shop?", reason: "clearer" }]);
    expect(result.plan.attaches.map((a) => a.to)).toEqual([q.id]);
    expect(result.plan.created.map((c) => c.question)).toEqual(["New question 1?", "New question 2?", "New question 3?"]);
    expect([result.tokensIn, result.tokensOut, result.aiCalls, result.openCount]).toEqual([120, 30, 1, 1]);
  });

  test("a failing model call propagates, so the caller can fall back to the mechanical plan", async () => {
    await open("Who is this?");
    fail = new Error("model unavailable");
    await expect(reconcileQueue([candidate("Q?")], TODAY, noContext)).rejects.toThrow("model unavailable");
  });
});
