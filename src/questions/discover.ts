/**
 * Proposes `context` questions: what the system should ask to fill gaps in what it knows about the
 * reader, from their calendar, tasks, personal mail and the news they were given. One `extractJson()`
 * call (prompt section `question_discovery`); the result goes into the queue's reconcile as candidates.
 */
import { and, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { contacts, dailyReports, db, extractions, questions, rawItems } from "../db";
import { selectNotes } from "../notes/select";
import { activePrompt } from "../ai/active-prompts";
import { extractJson, usageTally } from "../ai/openai";
import { formatForPrompt } from "../context/corrections";
import { loadLongTermContext, type LongTermContext } from "../pipeline/long-term-context";
import { addDays, daysAgo } from "../util/time";
import { squash } from "../util/text";
import type { CandidateInput } from "./reconcile";

/**
 * Open `context` questions at which discovery makes no call. The reliable way to a quiet day: a
 * prompt alone rarely gets a model to return nothing, so the pace follows how fast the reader answers.
 */
export const MAX_OPEN_CONTEXT_QUESTIONS = 3;
/** A ceiling, not a target: the prompt asks for one or two on most days (owner, 2026-10-11). */
const MAX_PER_RUN = 4;

const ASKED_DAYS = 90;
const CALENDAR_PAST_DAYS = 30;
const CALENDAR_AHEAD_DAYS = 14;
const MAIL_DAYS = 7;
const REPORT_COUNT = 3;
const MAX_CONTACTS = 300;
const MAIL_TYPES = ["personal_email", "sms"];

const SCHEMA = {
  name: "question_discovery",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "question", "evidence", "teaches"],
          properties: {
            type: { type: "string", enum: ["person", "thread", "opinion", "experience"] },
            question: { type: "string" },
            evidence: { type: "string" },
            teaches: { type: "string" },
          },
        },
      },
    },
  },
};

interface ModelAnswer {
  questions: { type: string; question: string; evidence: string; teaches: string }[];
}

export interface DiscoveryResult {
  candidates: CandidateInput[];
  /** Proposals the per-run cap left out, for the dry run. */
  unused: string[];
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
}

function parseJson(raw: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Markdown of a report line without links, so the model reads the story, not the URLs. */
function plainStory(md: string): string {
  return squash(md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_]/g, "").replace(/^-\s*/, ""), 300);
}

/** Calendar events seen in the window, one per event id (the latest snapshot), with how often their title recurs. */
async function calendarEvents(today: string) {
  const rows = await db
    .select({ raw: rawItems.rawContent, runDate: rawItems.runDate })
    .from(rawItems)
    .where(and(eq(rawItems.sourceType, "calendar"), gte(rawItems.runDate, daysAgo(CALENDAR_PAST_DAYS))))
    .orderBy(rawItems.runDate);
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const event = parseJson(r.raw);
    byId.set(String(event.id ?? r.raw), event);
  }
  const horizon = addDays(today, CALENDAR_AHEAD_DAYS);
  const events = [...byId.values()].filter((e) => String(e.start ?? "").slice(0, 10) <= horizon);
  const titleCount = new Map<string, number>();
  for (const e of events) titleCount.set(String(e.title), (titleCount.get(String(e.title)) ?? 0) + 1);
  return events
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map((e) => ({
      title: e.title ?? null,
      start: e.start ?? null,
      location: e.location ?? null,
      description: squash(e.description as string | null, 300) || null,
      events_with_this_title: titleCount.get(String(e.title)) ?? 1,
    }));
}

/** The latest task snapshot, open tasks only, grouped by list. */
async function openTasks() {
  const [latest] = await db
    .select({ runDate: rawItems.runDate })
    .from(rawItems)
    .where(eq(rawItems.sourceType, "todo"))
    .orderBy(desc(rawItems.runDate))
    .limit(1);
  if (!latest) return {};
  const rows = await db
    .select({ raw: rawItems.rawContent })
    .from(rawItems)
    .where(and(eq(rawItems.sourceType, "todo"), eq(rawItems.runDate, latest.runDate)));
  const byList: Record<string, string[]> = {};
  for (const r of rows) {
    const task = parseJson(r.raw);
    if (task.status === "completed" || !task.title) continue;
    const list = String(task.list_name ?? "Tasks");
    const due = task.due ? ` (due ${String(task.due).slice(0, 10)})` : "";
    (byList[list] ??= []).push(`${squash(task.title as string, 120)}${due}`);
  }
  return byList;
}

async function recentMail() {
  const rows = await db
    .select({
      type: rawItems.sourceType,
      from: rawItems.sourceName,
      raw: rawItems.rawContent,
      runDate: rawItems.runDate,
      extracted: extractions.extractedJson,
    })
    .from(rawItems)
    .leftJoin(extractions, eq(extractions.rawItemId, rawItems.id))
    .where(and(inArray(rawItems.sourceType, MAIL_TYPES), gte(rawItems.runDate, daysAgo(MAIL_DAYS))))
    .orderBy(rawItems.runDate);
  return rows.map((r) => {
    const text = r.raw ?? "";
    const json = (r.extracted ?? {}) as Record<string, unknown>;
    const cut = text.indexOf("\n\n");
    return {
      type: r.type,
      date: r.runDate,
      from: r.from,
      subject: text.match(/^Subject: (.*)$/m)?.[1]?.trim() ?? null,
      reading: squash([json.email_category ?? json.type, json.action_required].filter(Boolean).join(": "), 250) || null,
      excerpt: squash(cut >= 0 ? text.slice(cut + 2) : text, 400),
    };
  });
}

async function recentNews() {
  const rows = await db
    .select({ date: dailyReports.reportDate, json: dailyReports.reportJson })
    .from(dailyReports)
    .orderBy(desc(dailyReports.reportDate))
    .limit(REPORT_COUNT);
  return rows.flatMap((r) => [
    ...(r.json?.news ?? []).flatMap((g) => g.entries.map((e) => ({ date: r.date, group: g.group, story: plainStory(e.md) }))),
    ...(r.json?.intel ?? []).flatMap((g) => g.entries.map((e) => ({ date: r.date, group: g.domain, story: plainStory(e.md) }))),
  ]);
}

async function askedBefore() {
  const rows = await db
    .select({ kind: questions.kind, question: questions.question, status: questions.status, answer: questions.answer, firstAsked: questions.firstAsked })
    .from(questions)
    .where(and(gte(questions.firstAsked, daysAgo(ASKED_DAYS)), notInArray(questions.status, ["merged"])))
    .orderBy(questions.firstAsked);
  return rows.map((q) => ({ asked: q.firstAsked, question: q.question, status: q.status, answer: q.answer ? squash(q.answer, 300) : null }));
}

/**
 * The first `n` proposals, but one of each type before a second of any: the model ranks people and
 * threads above opinions, so a plain slice would never let an opinion question through. Keeps the model's order.
 */
export function pickVaried<T extends { type: string }>(proposed: T[], n: number): T[] {
  const seen = new Set<string>();
  const first = proposed.filter((q) => !seen.has(q.type) && seen.add(q.type));
  const picked = new Set([...first, ...proposed.filter((q) => !first.includes(q))].slice(0, Math.max(n, 0)));
  return proposed.filter((q) => picked.has(q));
}

/**
 * Up to `MAX_PER_RUN` `context` candidates for this run. Makes no call when `MAX_OPEN_CONTEXT_QUESTIONS`
 * are already waiting: the reader has not caught up, so more would only bury the ones there.
 * Below that the full ceiling applies, so the queue can briefly hold more than the pause threshold.
 */
export async function discoverQuestions(
  today: string,
  opts: { longTermContext?: LongTermContext; ignorePause?: boolean } = {},
): Promise<DiscoveryResult> {
  const none = { candidates: [], unused: [], tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  const waiting = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.status, "open"), eq(questions.kind, "context")));
  if (waiting.length >= MAX_OPEN_CONTEXT_QUESTIONS && !opts.ignorePause) {
    console.log(`[Questions] ${waiting.length} context question(s) still open, discovery skipped`);
    return none;
  }

  const [longTermContext, noteRows, contactRows, calendar, tasks, mail, news, asked] = await Promise.all([
    opts.longTermContext ?? loadLongTermContext(),
    selectNotes("reconcile", today),
    db
      .select({ name: contacts.name, identifier: contacts.identifier, relationship: contacts.relationship })
      .from(contacts)
      .where(isNull(contacts.removedAt))
      .limit(MAX_CONTACTS),
    calendarEvents(today),
    openTasks(),
    recentMail(),
    recentNews(),
    askedBefore(),
  ]);

  const payload = {
    today,
    known: {
      long_term_context: [longTermContext.personalSections, longTermContext.intelSections].filter(Boolean).join("\n\n") || null,
      context_corrections: longTermContext.corrections.length > 0 ? formatForPrompt(longTermContext.corrections) : null,
      notes: noteRows.map((n) => squash(n.content, 400)),
      contacts: contactRows.map((c) => [c.name ?? c.identifier, c.relationship].filter(Boolean).join(": ")),
    },
    asked_before: asked,
    calendar,
    tasks,
    mail,
    news,
  };

  const prompt = await activePrompt("question_discovery");
  const usage = usageTally();
  const answer = await extractJson<ModelAnswer>(prompt.text, JSON.stringify(payload), {
    schema: SCHEMA,
    // Spotting what is missing across a month of material is the whole job.
    reasoningEffort: "high",
    maxOutputTokens: 12000,
    onUsage: usage.onUsage,
  });

  const proposed = answer.questions.filter((q) => q.question.trim());
  const candidates: CandidateInput[] = pickVaried(proposed, MAX_PER_RUN)
    .map((q) => ({
      kind: "context" as const,
      question: squash(q.question, 400),
      source: null,
      why: squash(`${q.type}: ${q.evidence} (teaches: ${q.teaches})`, 300),
      detail: { type: q.type, evidence: squash(q.evidence, 300) },
    }));
  console.log(`[Questions] Discovery proposed ${proposed.map((q) => q.type).join(", ") || "nothing"}; passing ${candidates.length} on`);
  const unused = proposed.filter((q) => !candidates.some((c) => c.question === squash(q.question, 400)));
  return {
    candidates,
    unused: unused.map((q) => `${q.type}: ${q.question}`),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    aiCalls: 1,
  };
}
