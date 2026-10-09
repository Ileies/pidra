// src/pipeline/phase4-questiongate.ts against real SQL: which of the run's mail becomes a candidate and
// what the reconcile call is shown, what the queue holds afterwards, the fallback when that call keeps
// failing, and which answers reach Section 2. The model call is the only mock; retries do not wait.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Any = Record<string, any>;
const calls: Any[] = [];
let reply: Any = { existing: [], candidates: [], new_questions: [] };
let failure: Error | null = null;

mock.module("../src/ai/openai", () => ({
  extractJson: async (_prompt: string, input: string, options: Any) => {
    calls.push(JSON.parse(input));
    if (failure) throw failure;
    options.onUsage?.(120, 30);
    return reply;
  },
  usageTally: () => {
    const tally = { tokensIn: 0, tokensOut: 0, onUsage(i: number, o: number) { tally.tokensIn += i; tally.tokensOut += o; } };
    return tally;
  },
  synthesize: async () => { throw new Error("not expected"); },
}));
mock.module("../src/util/retry", () => ({
  retry: async (fn: (attempt: number) => Promise<unknown>, opts: { attempts: number }) => {
    for (let attempt = 1; ; attempt++) {
      try { return await fn(attempt); } catch (err) { if (attempt >= opts.attempts) throw err; }
    }
  },
}));

const database = await useTestDatabase();
const { db, questions } = await import("../src/db");
const { runQuestionGate } = await import("../src/pipeline/phase4-questiongate");

const DAY = "2026-10-05";
const noContext = { longTermContext: { corrections: [], intelSections: "", personalSections: "", interestSections: "", generatedAt: null, problem: null } } as never;

beforeEach(async () => {
  calls.length = 0;
  reply = { existing: [], candidates: [], new_questions: [] };
  failure = null;
  await database.sql`truncate raw_items, extractions, questions, notes, entities cascade`;
});

async function mail(over: { source?: string | null; content?: string | null; json?: Any; question?: string | null; unknown?: boolean; date?: string; type?: string } = {}) {
  const [raw] = await database.sql`
    insert into raw_items (run_date, source_type, source_name, raw_content)
    values (${over.date ?? DAY}::date, ${over.type ?? "personal_email"}, ${over.source === undefined ? "sam@example.com" : over.source}, ${over.content === undefined ? "Subject: Invoice 42\nFrom: Sam <sam@example.com>\n\nPlease  pay\nby Friday." : over.content}) returning id`;
  const [row] = await database.sql`
    insert into extractions (raw_item_id, run_date, extracted_json, unknown_context, question_for_user)
    values (${raw.id}, ${over.date ?? DAY}::date, ${JSON.stringify(over.json ?? { type: "request", urgency: "high", action_required: "pay" })}::text::jsonb, ${over.unknown ?? true}, ${over.question === undefined ? "Who is Sam?" : over.question})
    returning id`;
  return row.id as string;
}

const gate = (errors: Any[] = []) => runQuestionGate(noContext, DAY, errors);
const queue = async () => (await database.sql`select kind, question, status, sources from questions order by created_at, id`) as Any[];

describe("which mail becomes a candidate", () => {
  test("only this run's mail the classifier could not place, shown to the model as an excerpt, not the whole mail", async () => {
    const id = await mail({ content: `Subject:  Invoice 42 \nFrom: Sam <sam@example.com>\n\n${"word ".repeat(300)}` });
    await mail({ unknown: false, source: "placed@example.com" });
    await mail({ source: "spaced@example.com", content: "Subject: Hi\nFrom: a\n\nPlease  pay\n\n by   Friday." });
    await mail({ date: "2026-10-04", source: "yesterday@example.com" });
    await gate();

    expect(calls).toHaveLength(1);
    const byFrom = (from: string) => calls[0].candidates.find((c: Any) => c.about.from === from);
    expect(calls[0].candidates).toHaveLength(2);
    expect(byFrom("sam@example.com")).toMatchObject({
      kind: "item",
      question: "Who is Sam?",
      about: { type: "personal_email", from: "sam@example.com", subject: "Invoice 42", date: DAY },
      mail: { type: "request", urgency: "high", action_required: "pay", excerpt: "word ".repeat(300).trim().slice(0, 700) },
    });
    expect(byFrom("spaced@example.com").mail.excerpt).toBe("Please pay by Friday.");
    expect((await queue()).find((q) => q.sources[0].from === "sam@example.com")!.sources).toEqual([{ extraction_id: id, from: "sam@example.com", subject: "Invoice 42", source_type: "personal_email", run_date: DAY }]);
  });

  test("a mail without a question of its own is asked about who the sender is", async () => {
    await mail({ question: "   ", source: "noreply@example.com" });
    await mail({ question: null, source: null, content: null, json: {} });
    await gate();

    expect(calls[0].candidates.map((c: Any) => c.question)).toEqual([
      "Who is noreply@example.com, and how do they relate to you?",
      "Who is unknown, and how do they relate to you?",
    ]);
    expect(calls[0].candidates[1]).toMatchObject({ about: { subject: null }, mail: { type: null, urgency: null, action_required: null, excerpt: "" } });
  });

  test("a mail an open question already carries is not asked again, so a re-run adds nothing", async () => {
    await mail();
    await gate();
    expect(await queue()).toHaveLength(1);

    calls.length = 0;
    const second = await gate();
    expect(calls.every((c) => c.candidates.length === 0)).toBe(true);
    expect(second).toMatchObject({ fired: false, newQuestionCount: 0 });
    expect(await queue()).toHaveLength(1);
  });

  test("an undescribed entity is no candidate: the enrichment agent owns those", async () => {
    await database.sql`insert into entities (name, type, status, mention_count, first_seen) values ('Mystery Corp', 'org', 'active', 4, '2026-09-01')`;
    await gate();

    expect(calls.every((c) => c.candidates.length === 0)).toBe(true);
  });
});

describe("a mail that sits oddly against a contact's file", () => {
  const contact = (identifier: string, firstSeen: string, relationship: string | null) =>
    database.sql`insert into contacts (identifier, name, relationship, first_seen) values (${identifier}, ${identifier.split("@")[0]}, ${relationship}, ${firstSeen}::date)`;
  const flagged = (source: string, detail?: string) => mail({ source, unknown: false, json: { context_conflict: true, ...(detail ? { context_conflict_detail: detail } : {}) } });

  test("is asked about when the contact is old enough to have a settled file, in the words of the classifier", async () => {
    await contact("old@example.com", "2026-08-01", "my accountant");
    await contact("nodetail@example.com", "2026-08-01", "my landlord");
    await flagged("old@example.com", " now writes about a lawsuit ");
    await flagged("nodetail@example.com");
    await gate();

    const candidates = calls[0].candidates.sort((a: Any, b: Any) => a.about.from.localeCompare(b.about.from));
    expect(candidates.map((c: Any) => c.question)).toEqual([
      "A message from nodetail doesn't quite match what I have on file for them (my landlord) - what's changed?",
      "old: now writes about a lawsuit - does that change what I have on file (my accountant)?",
    ]);
    expect(candidates[1].mail).toEqual({ stored_relationship: "my accountant", stored_notes: null, conflict: "now writes about a lawsuit" });
  });

  test("is not asked about for a contact still being filled in, one without a file, an unflagged mail or a stranger", async () => {
    await contact("young@example.com", new Date().toISOString().slice(0, 10), "my accountant");
    await contact("blank@example.com", "2026-08-01", null);
    await contact("calm@example.com", "2026-08-01", "my landlord");
    await flagged("young@example.com");
    await flagged("blank@example.com");
    await flagged("stranger@example.com");
    await mail({ source: "calm@example.com", unknown: false, json: { context_conflict: false } });
    await gate();
    expect(calls).toHaveLength(0);
  });
});

describe("what the run does with them", () => {
  test("an empty day with an empty queue makes no call and asks nothing", async () => {
    const result = await gate();
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ fired: false, answers: [], newQuestionCount: 0, tokensIn: 0, tokensOut: 0, aiCalls: 0 });
  });

  test("a candidate the model leaves undecided is asked as it stands, and the call's usage is reported", async () => {
    await mail();
    const result = await gate();
    expect(result).toMatchObject({ fired: true, newQuestionCount: 1, tokensIn: 120, tokensOut: 30, aiCalls: 1 });
    const rows = await queue();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "item", question: "Who is Sam?", status: "open" });
  });

  test("the model can merge two mails from one sender into one reworded question", async () => {
    await mail();
    await mail({ question: "Who is Sam, really?" });
    reply = {
      existing: [],
      candidates: [{ id: "c1", action: "ask", target: "n1", reason: "" }, { id: "c2", action: "ask", target: "n1", reason: "" }],
      new_questions: [{ id: "n1", question: "Who is Sam and why does he send invoices?" }],
    };
    const result = await gate();
    expect(result.newQuestionCount).toBe(1);
    const rows = await queue();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ question: "Who is Sam and why does he send invoices?" });
    expect(rows[0].sources).toHaveLength(2);
  });

  test("when the reconcile call keeps failing the candidates are still asked, by sender, and the attempts are recorded", async () => {
    await mail();
    await mail({ question: "Who is Sam, really?" });
    failure = new Error("model down");
    const errors: Any[] = [];
    const result = await gate(errors);

    expect(calls).toHaveLength(3);
    expect(errors.map((e) => [e.step, e.attempt, e.error])).toEqual([1, 2, 3].map((n) => ["phase4-questions", n, "model down"]));
    expect(result).toMatchObject({ fired: true, newQuestionCount: 1, tokensIn: 0, tokensOut: 0, aiCalls: 0 });
    const rows = await queue();
    expect(rows).toHaveLength(1);
    expect(rows[0].sources).toHaveLength(2);
  });

  test("review answers given since the last run become notes before the questions are reconciled", async () => {
    await database.sql`insert into questions (kind, question, status, answer, answered_at, first_asked, last_asked) values ('review', 'Is the weekly digest useful?', 'answered', 'Yes, keep it.', now(), '2026-10-01', '2026-10-01')`;
    await gate();
    expect(await database.sql`select scope, content from notes`).toEqual([{ scope: "personal", content: "Is the weekly digest useful? Yes, keep it." }]);
    expect(await database.sql`select 1 from questions where absorbed_at is not null`).toHaveLength(1);
  });
});

describe("the answers Section 2 receives", () => {
  const answered = (kind: string, answer: string | null, daysAgo: number, sources: Any[]) => database.sql`
    insert into questions (kind, question, status, answer, answered_at, sources, first_asked, last_asked)
    values (${kind}, ${`${kind} question`}, 'answered', ${answer}, now() - make_interval(days => ${daysAgo}), ${JSON.stringify(sources)}::text::jsonb, '2026-09-20', '2026-09-20')`;
  const from = (name: string) => ({ extraction_id: null, from: name, subject: null, source_type: "personal_email", run_date: "2026-09-20" });

  test("item answers of the last seven days, with the senders once each and the day they were given", async () => {
    await answered("item", "My landlord", 2, [from("sam@example.com"), from("sam@example.com"), from("billing@example.com")]);
    await database.sql`update questions set question = 'Who is Sam?'`;
    const [{ day }] = await database.sql`select left(answered_at::text, 10) as day from questions`;
    const { answers } = await gate();
    expect(answers).toEqual([{ question: "Who is Sam?", answer: "My landlord", about: ["sam@example.com", "billing@example.com"], answered: day }]);
  });

  test("not review answers, not older ones, not a question closed without an answer, not an open one", async () => {
    await answered("review", "Yes", 1, []);
    await answered("chat", "Yes", 1, []);
    await answered("item", "Too old", 9, [from("old@example.com")]);
    await answered("item", null, 1, [from("silent@example.com")]);
    await database.sql`insert into questions (kind, question, status, first_asked, last_asked) values ('item', 'Still open?', 'open', '2026-10-01', '2026-10-01')`;
    expect((await gate()).answers).toEqual([]);
  });

  test("the oldest answer comes first", async () => {
    await answered("item", "newer", 1, [from("a@example.com")]);
    await answered("item", "older", 4, [from("b@example.com")]);
    expect((await gate()).answers.map((a) => a.answer)).toEqual(["older", "newer"]);
  });
});
