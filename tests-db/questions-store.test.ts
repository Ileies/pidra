// src/questions/store.ts against real SQL: status transitions, the event log, the chat-question
// cap and contact learning from an answer. The model call behind contact learning is the only mock.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

let classification = { relationship: "supplier of the reader's office", spam_or_irrelevant: false };
mock.module("../src/ai/openai", () => ({ extractJson: async () => classification }));
mock.module("../src/ai/active-prompts", () => ({ activePrompt: async () => ({ text: "classify" }) }));

const database = await useTestDatabase();
const { db, questions, contacts } = await import("../src/db");
const store = await import("../src/questions/store");
const { logEvent } = await import("../src/questions/events");

const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  classification = { relationship: "supplier of the reader's office", spam_or_irrelevant: false };
  await database.sql`truncate questions, contacts cascade`;
});

type Seed = Partial<typeof questions.$inferInsert>;

async function seed(over: Seed = {}) {
  const [row] = await db
    .insert(questions)
    .values({ kind: "item", question: "Who is this sender?", firstAsked: "2026-10-01", lastAsked: "2026-10-01", ...over })
    .returning();
  return row!;
}

const events = async (id: string) =>
  (await database.sql`select event, reason, detail from question_events where question_id = ${id} order by created_at, id`) as {
    event: string;
    reason: string | null;
    detail: Record<string, unknown> | null;
  }[];

const source = (from: string, extraction_id: string | null = null) => ({ extraction_id, from, subject: "Invoice", source_type: "email", run_date: "2026-10-01" });

describe("createChatQuestion", () => {
  test("queues a chat question and logs why it was asked", async () => {
    const { question, duplicate } = await store.createChatQuestion("  Is the Zurich office still open?  ", "saw two conflicting notes", "11111111-1111-4111-8111-111111111111");
    expect(duplicate).toBe(false);
    expect(question).toMatchObject({ kind: "chat", status: "open", question: "Is the Zurich office still open?", timesAsked: 1 });
    expect(await events(question.id)).toEqual([{ event: "asked", reason: "saw two conflicting notes", detail: { by: "chat", conversation_id: "11111111-1111-4111-8111-111111111111" } }]);
    expect(await store.askedReason(question.id)).toBe("saw two conflicting notes");
  });

  test("an identical open question, ignoring case and punctuation, is returned instead of asked twice", async () => {
    const first = await store.createChatQuestion("Is the Zurich office still open?", null, null);
    const again = await store.createChatQuestion("is the zurich OFFICE still open", null, null);
    expect(again.duplicate).toBe(true);
    expect(again.question.id).toBe(first.question.id);
    expect(await store.listOpen()).toHaveLength(1);
  });

  test("an empty question is invalid and the eleventh open chat question is refused", async () => {
    await expect(store.createChatQuestion("   ", null, null)).rejects.toMatchObject({ kind: "invalid", status: 400 });
    for (let i = 0; i < 10; i++) await store.createChatQuestion(`Distinct question number ${i}?`, null, null);
    await expect(store.createChatQuestion("One more distinct question?", null, null)).rejects.toMatchObject({ kind: "conflict", status: 409 });
  });
});

describe("answerQuestion", () => {
  test("open to answered, with the trimmed answer, a timestamp and an event", async () => {
    const q = await seed({ kind: "review" });
    const answered = await store.answerQuestion(q.id, "  Yes, keep it.  ");
    expect(answered).toMatchObject({ status: "answered", answer: "Yes, keep it." });
    expect(answered.answeredAt).not.toBeNull();
    expect((await events(q.id)).map((e) => e.event)).toEqual(["answered"]);
  });

  test("refuses an empty answer, an unknown id and a question that is no longer open", async () => {
    const q = await seed({ kind: "review" });
    await expect(store.answerQuestion(q.id, "  ")).rejects.toMatchObject({ kind: "invalid" });
    await expect(store.answerQuestion(MISSING, "x")).rejects.toMatchObject({ kind: "not_found", status: 404 });
    await store.dismissQuestion(q.id);
    await expect(store.answerQuestion(q.id, "x")).rejects.toMatchObject({ kind: "conflict", message: "This question is already dismissed" });
    expect((await store.listQuestions({ status: "all" }))[0]!.answer).toBeNull();
  });

  test("an item question about one address teaches the contact directory the standing relationship", async () => {
    const q = await seed({ sources: [source("Billing@Supplier.example.com"), source("billing@supplier.example.com")] });
    await store.answerQuestion(q.id, "They supply our office, pay on time.");
    const rows = await db.select().from(contacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ identifier: "billing@supplier.example.com", relationship: "supplier of the reader's office", firstSeen: "2026-10-01" });
  });

  test("spam, several senders, a non-address sender and review questions teach nothing", async () => {
    classification = { relationship: "x", spam_or_irrelevant: true };
    await store.answerQuestion((await seed({ sources: [source("a@spam.example.com")] })).id, "spam");
    classification = { relationship: "a real relationship", spam_or_irrelevant: false };
    await store.answerQuestion((await seed({ sources: [source("a@one.example.com"), source("b@two.example.com")] })).id, "both");
    await store.answerQuestion((await seed({ sources: [source("Newsletter Name")] })).id, "no address");
    await store.answerQuestion((await seed({ kind: "review", sources: [source("c@three.example.com")] })).id, "review");
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  test("a locked contact keeps its relationship, an unlocked one is updated", async () => {
    await db.insert(contacts).values([
      { identifier: "locked@corp.example.com", relationship: "set by a correction", locked: true },
      { identifier: "open@corp.example.com", relationship: "old" },
    ]);
    await store.answerQuestion((await seed({ sources: [source("locked@corp.example.com")] })).id, "a");
    await store.answerQuestion((await seed({ sources: [source("open@corp.example.com")] })).id, "b");
    const byId = Object.fromEntries((await db.select().from(contacts)).map((c) => [c.identifier, c.relationship]));
    expect(byId).toEqual({ "locked@corp.example.com": "set by a correction", "open@corp.example.com": "supplier of the reader's office" });
  });
});

describe("dismissQuestion and reopenQuestion", () => {
  test("dismiss records the reason and an event, and cannot repeat", async () => {
    const q = await seed();
    const dismissed = await store.dismissQuestion(q.id);
    expect(dismissed).toMatchObject({ status: "dismissed", statusDetail: "Dismissed by the reader." });
    expect(await events(q.id)).toEqual([{ event: "dismissed", reason: "Dismissed by the reader.", detail: null }]);
    await expect(store.dismissQuestion(q.id)).rejects.toMatchObject({ kind: "conflict" });
    await expect(store.dismissQuestion(MISSING)).rejects.toMatchObject({ kind: "not_found" });
  });

  test("dismissed and resolved come back open with their detail cleared; an answered one does not", async () => {
    const dismissed = await seed({ status: "dismissed", statusDetail: "gone" });
    const resolved = await seed({ status: "resolved", statusDetail: "settled by a note" });
    const answered = await seed({ status: "answered", answer: "done" });
    for (const q of [dismissed, resolved]) {
      expect(await store.reopenQuestion(q.id)).toMatchObject({ status: "open", statusDetail: null, mergedInto: null });
      expect((await events(q.id)).map((e) => e.event)).toEqual(["reopened"]);
    }
    await expect(store.reopenQuestion(answered.id)).rejects.toMatchObject({ kind: "conflict", message: "An answered question cannot be reopened" });
    await expect(store.reopenQuestion((await seed()).id)).rejects.toMatchObject({ kind: "conflict" });
  });

  test("a merged question stays merged while its target is open, and returns once the target is closed", async () => {
    const target = await seed({ question: "Target question?" });
    const merged = await seed({ question: "Duplicate question?", status: "merged", mergedInto: target.id });
    await expect(store.reopenQuestion(merged.id)).rejects.toMatchObject({ kind: "conflict", message: "It was merged into a question that is still open" });

    await store.dismissQuestion(target.id);
    expect(await store.reopenQuestion(merged.id)).toMatchObject({ status: "open", mergedInto: null });
  });
});

describe("listQuestions", () => {
  test("filters by status, kind and text in question or answer, oldest first", async () => {
    const a = await seed({ question: "Alpha budget?" });
    const b = await seed({ question: "Beta travel?", kind: "review", status: "answered", answer: "Budget is fine" });
    const c = await seed({ question: "Gamma?", status: "dismissed" });
    const ids = async (opts: Parameters<typeof store.listQuestions>[0]) => (await store.listQuestions(opts)).map((q) => q.id);

    expect(await ids({})).toEqual([a.id]);
    expect(await ids({ status: "all" })).toEqual([a.id, b.id, c.id]);
    expect(await ids({ status: "answered", kind: "review" })).toEqual([b.id]);
    expect(await ids({ status: "all", query: "BUDGET" })).toEqual([a.id, b.id]);
  });

  test("a percent sign or underscore in the search is literal", async () => {
    const hit = await seed({ question: "Is the 100% figure right?" });
    await seed({ question: "Something else entirely" });
    expect((await store.listQuestions({ status: "all", query: "100%" })).map((q) => q.id)).toEqual([hit.id]);
    expect(await store.listQuestions({ status: "all", query: "_" })).toHaveLength(0);
  });

  test("rejects an unknown status or kind", async () => {
    await expect(store.listQuestions({ status: "pending" })).rejects.toMatchObject({ kind: "invalid" });
    await expect(store.listQuestions({ kind: "other" })).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("what the pipeline reads", () => {
  test("askedExtractionIds gathers every extraction an item question carries, and only those", async () => {
    await seed({ sources: [source("a@x.example.com", "e1"), source("b@x.example.com", null)] });
    await seed({ sources: [source("c@x.example.com", "e2")] });
    await seed({ kind: "chat", sources: [source("d@x.example.com", "e3")] });
    expect([...(await store.askedExtractionIds())].sort()).toEqual(["e1", "e2"]);
  });

  test("listRecentlyAnswered keeps answers inside the window, oldest first", async () => {
    const old = await seed({ status: "answered", answer: "old" });
    const recent = await seed({ status: "answered", answer: "recent" });
    const newest = await seed({ status: "answered", answer: "newest" });
    await seed({ question: "still open" });
    await database.sql`update questions set answered_at = now() - interval '10 days' where id = ${old.id}`;
    await database.sql`update questions set answered_at = now() - interval '2 days' where id = ${recent.id}`;
    await database.sql`update questions set answered_at = now() - interval '1 day' where id = ${newest.id}`;
    expect((await store.listRecentlyAnswered(7)).map((q) => q.answer)).toEqual(["recent", "newest"]);
  });

  test("answered review questions are listed until they are absorbed", async () => {
    const review = await seed({ kind: "review", status: "answered", answer: "a" });
    await seed({ kind: "item", status: "answered", answer: "b" });
    expect((await store.unabsorbedReviewAnswers()).map((q) => q.id)).toEqual([review.id]);
    await store.markAbsorbed([]);
    await store.markAbsorbed([review.id]);
    expect(await store.unabsorbedReviewAnswers()).toHaveLength(0);
  });

  test("getAnsweredQuestion refuses a question that is not answered; setAnswerOutcome records how it went", async () => {
    const open = await seed();
    await expect(store.getAnsweredQuestion(open.id)).rejects.toMatchObject({ kind: "conflict", message: "This question is open, not answered" });
    const answered = await seed({ status: "answered", answer: "yes" });
    await store.setAnswerOutcome(answered.id, "running", null, "22222222-2222-4222-8222-222222222222");
    await store.setAnswerOutcome(answered.id, "done", "changed one note");
    expect(await store.getAnsweredQuestion(answered.id)).toMatchObject({
      answerStatus: "done",
      answerOutcome: "changed one note",
      answerConversationId: "22222222-2222-4222-8222-222222222222",
    });
  });
});

describe("logEvent", () => {
  test("never throws: a failing insert is swallowed so the change it explains survives", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      await expect(logEvent(db, MISSING, "asked")).resolves.toBeUndefined();
    } finally {
      console.error = quiet;
    }
    const [{ n }] = await database.sql`select count(*)::int as n from question_events`;
    expect(n).toBe(0);
  });
});
