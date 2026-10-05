// src/questions/apply-plan.ts against real SQL: what each part of a reconcile plan writes to
// `questions` and `question_events`, which questions it leaves alone (anything not open), and that a
// failing write rolls the whole plan back. No mocks: applyPlan makes no model call.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, questions } = await import("../src/db");
const { applyPlan } = await import("../src/questions/apply-plan");

const TODAY = "2026-10-05";
const MISSING = "00000000-0000-4000-8000-000000000000";
const empty = { rewrites: [], resolves: [], merges: [], attaches: [], created: [], dropped: [] };

beforeEach(async () => {
  await database.sql`truncate questions cascade`;
});

type Seed = Partial<typeof questions.$inferInsert>;
const source = (from: string) => ({ extraction_id: null, from, subject: "Invoice", source_type: "email", run_date: "2026-10-04" });
const candidate = (question: string, from: string | null = "shop@example.com") => ({ kind: "item" as const, question, source: from ? source(from) : null });

async function seed(over: Seed = {}) {
  const [row] = await db
    .insert(questions)
    .values({ kind: "item", question: "Who is this sender?", firstAsked: "2026-10-01", lastAsked: "2026-10-03", ...over })
    .returning();
  return row!;
}

const row = async (id: string) =>
  (await database.sql`select question, status, status_detail, merged_into, sources, history, first_asked::text as first_asked, last_asked::text as last_asked, times_asked from questions where id = ${id}`)[0] as {
    question: string;
    status: string;
    status_detail: string | null;
    merged_into: string | null;
    sources: { from: string }[];
    history: { question: string; by: string; reason: string | null; at: string }[];
    first_asked: string;
    last_asked: string;
    times_asked: number;
  };

const events = async (id: string) =>
  (await database.sql`select event, reason, detail from question_events where question_id = ${id} order by created_at, id`) as {
    event: string;
    reason: string | null;
    detail: Record<string, unknown> | null;
  }[];

describe("an empty plan", () => {
  test("writes nothing and touches nothing", async () => {
    await seed();
    expect(await applyPlan(empty, TODAY)).toEqual([]);
    expect(await database.sql`select count(*)::int as n from question_events`).toEqual([{ n: 0 }]);
  });
});

describe("rewrites", () => {
  test("replace the text, keep the old one in the history with the reason, and log it", async () => {
    const q = await seed({ question: "Who is Anna?" });
    const touched = await applyPlan({ ...empty, rewrites: [{ id: q.id, question: "Who is Anna, and is she a client?", reason: "too thin" }] }, TODAY);

    const after = await row(q.id);
    expect(after.question).toBe("Who is Anna, and is she a client?");
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ question: "Who is Anna?", by: "model", reason: "too thin" });
    expect(await events(q.id)).toEqual([{ event: "rewritten", reason: "too thin", detail: null }]);
    expect(touched).toEqual([]);
  });

  test("the same text is not a rewrite: no history entry, no event", async () => {
    const q = await seed({ question: "Who is Anna?" });
    await applyPlan({ ...empty, rewrites: [{ id: q.id, question: "Who is Anna?", reason: "same" }] }, TODAY);
    expect((await row(q.id)).history).toEqual([]);
    expect(await events(q.id)).toEqual([]);
  });

  test("a second rewrite appends to the history instead of replacing it", async () => {
    const q = await seed({ question: "A?" });
    await applyPlan({ ...empty, rewrites: [{ id: q.id, question: "B?", reason: "one" }] }, TODAY);
    await applyPlan({ ...empty, rewrites: [{ id: q.id, question: "C?", reason: "two" }] }, TODAY);
    const after = await row(q.id);
    expect(after.history.map((h) => h.question)).toEqual(["A?", "B?"]);
    expect(after.question).toBe("C?");
  });
});

describe("questions that are not open, or do not exist", () => {
  test("are left exactly as they are by every part of a plan", async () => {
    const answered = await seed({ question: "Answered", status: "answered", answer: "yes" });
    const open = await seed({ question: "Open" });
    const ids = [answered.id, MISSING];
    const touched = await applyPlan(
      {
        rewrites: ids.map((id) => ({ id, question: "changed", reason: "r" })),
        resolves: ids.map((id) => ({ id, reason: "r" })),
        merges: [
          { id: answered.id, into: open.id, reason: "r" },
          { id: open.id, into: answered.id, reason: "r" },
          { id: open.id, into: MISSING, reason: "r" },
        ],
        attaches: ids.map((id) => ({ candidate: candidate("again"), to: id })),
        created: [],
        dropped: [],
      },
      TODAY,
    );

    expect(touched).toEqual([]);
    expect(await row(answered.id)).toMatchObject({ question: "Answered", status: "answered", sources: [], times_asked: 1 });
    expect(await row(open.id)).toMatchObject({ question: "Open", status: "open", sources: [], times_asked: 1 });
    expect(await database.sql`select count(*)::int as n from question_events`).toEqual([{ n: 0 }]);
  });
});

describe("resolves", () => {
  test("close the question with the reason and log it", async () => {
    const q = await seed();
    await applyPlan({ ...empty, resolves: [{ id: q.id, reason: "answered by a later mail" }] }, TODAY);
    expect(await row(q.id)).toMatchObject({ status: "resolved", status_detail: "answered by a later mail" });
    expect(await events(q.id)).toEqual([{ event: "resolved", reason: "answered by a later mail", detail: null }]);
  });

  test("a question resolved in the plan can no longer be merged into or attached to", async () => {
    const gone = await seed({ question: "Gone" });
    const keeper = await seed({ question: "Keeper" });
    const touched = await applyPlan(
      {
        ...empty,
        resolves: [{ id: gone.id, reason: "done" }],
        merges: [{ id: keeper.id, into: gone.id, reason: "r" }],
        attaches: [{ candidate: candidate("more"), to: gone.id }],
      },
      TODAY,
    );
    expect(touched).toEqual([]);
    expect(await row(keeper.id)).toMatchObject({ status: "open", times_asked: 1 });
    expect((await row(gone.id)).sources).toEqual([]);
  });
});

describe("merges", () => {
  test("the target inherits the mails, the asked count and the earliest first-asked date; the source points at it", async () => {
    const target = await seed({ question: "Target", sources: [source("a@example.com")], timesAsked: 2, firstAsked: "2026-10-02" });
    const merged = await seed({ question: "Merged", sources: [source("b@example.com")], timesAsked: 4, firstAsked: "2026-09-20" });
    await applyPlan({ ...empty, merges: [{ id: merged.id, into: target.id, reason: "same person" }] }, TODAY);

    const t = await row(target.id);
    expect(t.sources.map((s) => s.from)).toEqual(["a@example.com", "b@example.com"]);
    expect(t).toMatchObject({ status: "open", times_asked: 6, first_asked: "2026-09-20" });
    expect(await row(merged.id)).toMatchObject({ status: "merged", merged_into: target.id, status_detail: "same person" });
    expect(await events(merged.id)).toEqual([{ event: "merged", reason: "same person", detail: { merged_into: target.id } }]);
    expect(await events(target.id)).toEqual([]);
  });

  test("a target with the earlier first-asked date keeps it", async () => {
    const target = await seed({ firstAsked: "2026-09-01" });
    const merged = await seed({ firstAsked: "2026-10-02" });
    await applyPlan({ ...empty, merges: [{ id: merged.id, into: target.id, reason: "r" }] }, TODAY);
    expect((await row(target.id)).first_asked).toBe("2026-09-01");
  });
});

describe("attaches", () => {
  test("a new mail on an open question counts as one more asking, on today's date", async () => {
    const q = await seed({ sources: [source("a@example.com")], timesAsked: 2, lastAsked: "2026-10-03" });
    const touched = await applyPlan({ ...empty, attaches: [{ candidate: candidate("again", "b@example.com"), to: q.id }] }, TODAY);

    expect(touched).toEqual([q.id]);
    const after = await row(q.id);
    expect(after).toMatchObject({ times_asked: 3, last_asked: TODAY });
    expect(after.sources.map((s) => s.from)).toEqual(["a@example.com", "b@example.com"]);
    expect(await events(q.id)).toEqual([{ event: "reasked", reason: null, detail: { candidates: 1 } }]);
  });

  test("two candidates on one question are asked once more, not twice, and both mails are kept", async () => {
    const q = await seed({ timesAsked: 2 });
    await applyPlan(
      { ...empty, attaches: [{ candidate: candidate("x", "a@example.com"), to: q.id }, { candidate: candidate("y", "b@example.com"), to: q.id }] },
      TODAY,
    );
    const after = await row(q.id);
    expect(after.times_asked).toBe(3);
    expect(after.sources.map((s) => s.from)).toEqual(["a@example.com", "b@example.com"]);
    expect(await events(q.id)).toEqual([{ event: "reasked", reason: null, detail: { candidates: 2 } }]);
  });

  test("a question already asked today keeps its count, and a candidate without a mail adds no source", async () => {
    const q = await seed({ timesAsked: 2, lastAsked: TODAY });
    const touched = await applyPlan({ ...empty, attaches: [{ candidate: candidate("again", null), to: q.id }] }, TODAY);
    expect(touched).toEqual([q.id]);
    expect(await row(q.id)).toMatchObject({ times_asked: 2, last_asked: TODAY, sources: [] });
  });
});

describe("created and dropped", () => {
  test("a new question opens with its mails and today's dates, and is reported as touched", async () => {
    const touched = await applyPlan(
      { ...empty, created: [{ kind: "review", question: "Who is Anna?", candidates: [candidate("x", "a@example.com"), candidate("y", null), candidate("z", "b@example.com")] }] },
      TODAY,
    );

    expect(touched).toHaveLength(1);
    const made = await row(touched[0]!);
    expect(made).toMatchObject({ question: "Who is Anna?", status: "open", first_asked: TODAY, last_asked: TODAY, times_asked: 1 });
    expect(made.sources.map((s) => s.from)).toEqual(["a@example.com", "b@example.com"]);
    expect((await database.sql`select kind from questions where id = ${touched[0]!}`)[0].kind).toBe("review");
    expect(await events(touched[0]!)).toEqual([{ event: "asked", reason: null, detail: null }]);
  });

  test("a dropped candidate is kept as a resolved question with the reason, and is not reported as touched", async () => {
    const touched = await applyPlan({ ...empty, dropped: [{ candidate: candidate("Spam sender?", "ads@example.com"), reason: "newsletter" }] }, TODAY);

    expect(touched).toEqual([]);
    const [kept] = (await database.sql`select id, kind, question, status, status_detail from questions`) as { id: string; kind: string; question: string; status: string; status_detail: string }[];
    expect(kept).toMatchObject({ kind: "item", question: "Spam sender?", status: "resolved", status_detail: "newsletter" });
    expect(await events(kept!.id)).toEqual([{ event: "dropped", reason: "newsletter", detail: null }]);
  });
});

describe("one transaction", () => {
  test("a write that fails undoes everything the plan did before it", async () => {
    const q = await seed({ question: "Before" });
    const broken = { ...empty, rewrites: [{ id: q.id, question: "After", reason: "r" }], created: [{ kind: "item" as const, question: null as unknown as string, candidates: [] }] };

    await expect(applyPlan(broken, TODAY)).rejects.toThrow();
    expect((await row(q.id)).question).toBe("Before");
    expect(await database.sql`select count(*)::int as n from question_events`).toEqual([{ n: 0 }]);
    expect(await database.sql`select count(*)::int as n from questions`).toEqual([{ n: 1 }]);
  });
});
