// src/questions/discover.ts against real SQL: what the discovery call is shown (calendar, tasks, mail,
// news, earlier questions), when it makes no call, and which of its proposals become candidates.
// The model call is the only mock.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

type Any = Record<string, any>;
const calls: Any[] = [];
let reply: Any = { questions: [] };

mock.module("../src/ai/openai", () => ({
  extractJson: async (_prompt: string, input: string, options: Any) => {
    calls.push(JSON.parse(input));
    options.onUsage?.(100, 10);
    return reply;
  },
  usageTally: () => {
    const tally = { tokensIn: 0, tokensOut: 0, onUsage(i: number, o: number) { tally.tokensIn += i; tally.tokensOut += o; } };
    return tally;
  },
}));

const database = await useTestDatabase();
const { discoverQuestions, pickVaried, MAX_OPEN_CONTEXT_QUESTIONS } = await import("../src/questions/discover");
const { addDays, utcDay } = await import("../src/util/time");

const today = utcDay();
const noContext = { corrections: [], intelSections: "", personalSections: "Drives a car.", interestSections: "", generatedAt: null, problem: null } as never;
const discover = () => discoverQuestions(today, { longTermContext: noContext });

beforeEach(async () => {
  calls.length = 0;
  reply = { questions: [] };
  await database.sql`truncate raw_items, extractions, questions, daily_reports, notes cascade`;
});

async function raw(type: string, runDate: string, content: string, source = "Google") {
  const [row] = await database.sql`insert into raw_items (run_date, source_type, source_name, raw_content) values (${runDate}::date, ${type}, ${source}, ${content}) returning id`;
  return row.id as string;
}
const event = (id: string, title: string, start: string, extra: Any = {}) => JSON.stringify({ id, title, start, location: null, description: null, ...extra });
const task = (title: string, status = "needsAction", list = "Plans") => JSON.stringify({ id: title, title, status, list_name: list, due: null });
const proposal = (type: string, question: string) => ({ type, question, evidence: `seen: ${question}`, teaches: "something" });

describe("what the discovery call is shown", () => {
  test("each calendar event once, in its latest form, with how often its title recurs, up to two weeks ahead", async () => {
    await raw("calendar", addDays(today, -5), event("a", "Driving lesson", `${addDays(today, -4)}T12:00:00+02:00`));
    await raw("calendar", addDays(today, -3), event("a", "Driving lesson", `${addDays(today, -4)}T12:00:00+02:00`, { location: "Moved" }));
    await raw("calendar", addDays(today, -1), event("b", "Driving lesson", `${addDays(today, 2)}T12:00:00+02:00`));
    await raw("calendar", today, event("c", "Far away", `${addDays(today, 30)}T12:00:00+02:00`));
    await raw("calendar", addDays(today, -40), event("d", "Too old", `${addDays(today, -40)}T12:00:00+02:00`));
    await discover();

    expect(calls[0].calendar.map((e: Any) => [e.title, e.location, e.events_with_this_title])).toEqual([
      ["Driving lesson", "Moved", 2],
      ["Driving lesson", null, 2],
    ]);
  });

  test("only open tasks of the latest snapshot, by list; personal mail of the last week with the classifier's reading", async () => {
    await raw("todo", addDays(today, -1), task("Stale snapshot"));
    await raw("todo", today, task("Theory exam"));
    await raw("todo", today, task("Done already", "completed"));
    const id = await raw("personal_email", addDays(today, -1), "Subject: You sent a payment\nFrom: service@example.com\n\nYou sent 26 EUR to Alex  Example.", "service@example.com");
    await database.sql`insert into extractions (raw_item_id, run_date, extracted_json) values (${id}, ${addDays(today, -1)}::date, ${JSON.stringify({ email_category: "automated", action_required: "Check the payment" })}::text::jsonb)`;
    await raw("personal_email", addDays(today, -10), "Subject: Old\nFrom: x\n\nold", "old@example.com");
    await raw("newsletter", today, "Subject: News\nFrom: n\n\nnews", "news@example.com");
    await discover();

    expect(calls[0].tasks).toEqual({ Plans: ["Theory exam"] });
    expect(calls[0].mail).toEqual([
      { type: "personal_email", date: addDays(today, -1), from: "service@example.com", subject: "You sent a payment", reading: "automated: Check the payment", excerpt: "You sent 26 EUR to Alex Example." },
    ]);
  });

  test("the last reports' stories without links, and the earlier questions with their status and answer", async () => {
    const json = { version: 1, date: today, personal: [], alsoNoted: [], news: [{ group: "Top stories", entries: [{ md: "- **Zurich beat Thun 4:2.** [Source](https://example.com/a)", refIds: [] }] }], intel: [{ domain: "AI", entries: [{ md: "- A new model shipped. [B](https://example.com/b)", refIds: [] }] }] };
    await database.sql`insert into daily_reports (report_date, report_json) values (${today}::date, ${JSON.stringify(json)}::text::jsonb)`;
    await database.sql`insert into questions (kind, question, status, answer, first_asked, last_asked) values ('item', 'What is Amazon?', 'dismissed', null, ${today}::date, ${today}::date), ('review', 'Most valuable report?', 'answered', 'I just read out of curiosity.', ${today}::date, ${today}::date)`;
    await discover();

    expect(calls[0].news).toEqual([
      { date: today, group: "Top stories", story: "Zurich beat Thun 4:2. Source" },
      { date: today, group: "AI", story: "A new model shipped. B" },
    ]);
    expect(calls[0].asked_before.map((q: Any) => [q.question, q.status, q.answer])).toEqual([
      ["What is Amazon?", "dismissed", null],
      ["Most valuable report?", "answered", "I just read out of curiosity."],
    ]);
    expect(calls[0].known.long_term_context).toBe("Drives a car.");
  });
});

describe("what becomes of the proposals", () => {
  test("a person, a thread and an opinion before a second of any type, in the model's order, as context candidates", async () => {
    reply = { questions: [proposal("person", "P1?"), proposal("person", "P2?"), proposal("thread", "T1?"), proposal("thread", "T2?"), proposal("opinion", "O1?")] };
    const result = await discover();

    expect(result.candidates.map((c) => c.question)).toEqual(["P1?", "P2?", "T1?", "O1?"]);
    expect(result.candidates[0]).toMatchObject({ kind: "context", source: null, why: "person: seen: P1? (teaches: something)", detail: { type: "person", evidence: "seen: P1?" } });
    expect(result.unused).toEqual(["thread: T2?"]);
    expect(result).toMatchObject({ tokensIn: 100, tokensOut: 10, aiCalls: 1 });
  });

  test("makes no call while enough context questions wait; one below that, the day's full ceiling still applies", async () => {
    const insert = (n: number) =>
      database.sql`insert into questions (kind, question, first_asked, last_asked) select 'context', 'Q' || g, ${today}::date, ${today}::date from generate_series(1, ${n}) g`;
    await insert(MAX_OPEN_CONTEXT_QUESTIONS - 1);
    reply = { questions: [proposal("person", "P1?"), proposal("thread", "T1?")] };
    expect((await discover()).candidates.map((c) => c.question)).toEqual(["P1?", "T1?"]);

    await insert(1);
    expect(await discover()).toMatchObject({ candidates: [], aiCalls: 0 });
    expect(calls).toHaveLength(1);
  });

  test("pickVaried fills up with repeats when there are too few types", () => {
    const list = [{ type: "a", n: 1 }, { type: "a", n: 2 }, { type: "b", n: 3 }, { type: "a", n: 4 }];
    expect(pickVaried(list, 3).map((x) => x.n)).toEqual([1, 2, 3]);
    expect(pickVaried(list, 0)).toEqual([]);
  });
});
