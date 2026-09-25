/**
 * Quick actions: the one-tap buttons the report offers beside a personal item.
 *
 * A separate model call, not a field of the Section 2 synthesis. Section 2 is asked to write,
 * and a writer handed a "suggestions" field fills it; this call is asked one narrower question,
 * whether a mail is worth a button, and is told that the normal answer is no. Its prompt is the
 * `quick_actions` section (`QUICK_ACTIONS_PROMPT`), overridable on /prompts like any other.
 *
 * The model proposes, code decides, the same split as the news desks:
 * - It sees short ids ("m1", "c3", "t12"), never a UUID or a Google id, and code maps them back.
 *   An id that maps to nothing discards the action rather than guessing.
 * - Every date is parsed as a wall-clock time in `HOME_TIME_ZONE` and turned into an instant here,
 *   so a server running in UTC cannot move an appointment by two hours.
 * - An event is checked against the calendar on its own day, not only against the seven days
 *   Phase 1 ingests, and a task against the whole open list rather than the 40 Section 2 gets.
 * - Hard caps: two per mail, `MAX_ACTIONS` per day.
 * What code throws out is still written, as `discarded` with the reason (`store.ts`), so tuning
 * the prompt can start from the table.
 *
 * What it reads: the day's personal mail and SMS that passed the gate, plus automated mail the gate
 * dropped as low urgency when the classifier flagged a calendar event or a to-do in it - a booking
 * confirmation is automated mail, and it is the case this feature exists for. It reads the mail text
 * itself, since the classification carries no times or places, and answers in strict JSON only,
 * which makes it an extraction-shaped call: no prose from it ever reaches the report.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { activePrompt } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";
import { listCalendarEvents, type CalendarEvent, type TodoItem } from "../ingest/google";
import type { ContextPayload } from "../pipeline/phase3-context";
import { HOME_TIME_ZONE, addDays, isLocalDate, localDay, zonedToIso } from "../util/time";
import { stripControlChars } from "../util/text";

export const ACTION_KINDS = ["add_event", "update_event", "add_todo", "complete_todo"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * The skill each kind runs, and the only skills a quick action can run: a row's `skill_name` is
 * always one of these, which is why a tap needs no surface check of its own (`store.ts`).
 */
export const SKILL_FOR: Record<ActionKind, string> = {
  add_event: "add_calendar_event",
  update_event: "update_calendar_event",
  add_todo: "add_todo_item",
  complete_todo: "complete_todo_item",
};

/**
 * What the button shows, so the reader knows exactly what a tap will write before making it.
 * Timed values are UTC instants and the dashboard formats them; a whole-day `end` is the last
 * day, inclusive, whatever the Calendar API wants.
 */
export type ActionPreview =
  | { kind: "add_event"; title: string; start: string; end: string; allDay: boolean; location: string | null }
  | {
      kind: "update_event";
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      location: string | null;
      was: { start: string; end: string; allDay: boolean; location: string | null };
    }
  | { kind: "add_todo"; title: string; due: string | null; notes: string | null }
  | { kind: "complete_todo"; title: string; list: string };

export type DiscardReason =
  | "unknown_mail"
  | "empty_title"
  | "bad_time"
  | "in_past"
  | "already_in_calendar"
  | "unknown_event"
  | "no_change"
  | "already_on_list"
  | "unknown_task"
  | "duplicate"
  | "per_mail_cap"
  | "daily_cap"
  /** A re-run proposed what the reader already did or dismissed for this date (`store.ts`). */
  | "already_handled";

export interface Proposal {
  kind: ActionKind;
  skillName: string;
  parameters: Record<string, unknown>;
  preview: ActionPreview;
  reason: string;
  sourceExtractionIds: string[];
  /** Null when the action is offered; otherwise why code threw it out. */
  discarded: DiscardReason | null;
}

const MAX_ACTIONS = 6;
const MAX_PER_MAIL = 2;
/** Enough for any real appointment mail; a newsletter-length automated mail is cut. */
const MAIL_CHARS = 6000;

interface ModelAction {
  kind: ActionKind;
  mail_ids: string[];
  why: string;
  title: string;
  start: string;
  end: string;
  location: string;
  notes: string;
  due: string;
  event_id: string;
  task_id: string;
}

const STRING = { type: "string" };

/** Flat, with "" for a field that does not apply, like the desks' schema: no nullable unions to drift. */
const ACTIONS_SCHEMA = {
  name: "quick_actions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["actions"],
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "mail_ids", "why", "title", "start", "end", "location", "notes", "due", "event_id", "task_id"],
          properties: {
            kind: { type: "string", enum: [...ACTION_KINDS] },
            mail_ids: { type: "array", items: STRING },
            why: STRING,
            title: STRING,
            start: STRING,
            end: STRING,
            location: STRING,
            notes: STRING,
            due: STRING,
            event_id: STRING,
            task_id: STRING,
          },
        },
      },
    },
  },
};

interface Mail {
  shortId: string;
  /** Every extraction of this mail on this run: Phase 2 can leave several, and any may be cited. */
  extractionIds: string[];
  sourceType: string;
  receivedAt: string | null;
  text: string;
  classification: Record<string, unknown>;
}

/**
 * The mails the agent may act on. Grouped by raw item, because a re-run of Phase 2 leaves one
 * extraction row per attempt (TODO.md, Now) and the report may cite any of them.
 */
async function candidateMails(runDate: string): Promise<Mail[]> {
  const rows = await db
    .select({
      extractionId: extractions.id,
      rawItemId: rawItems.id,
      sourceType: rawItems.sourceType,
      receivedAt: rawItems.receivedAt,
      rawContent: rawItems.rawContent,
      json: extractions.extractedJson,
      gatePassed: extractions.gatePassed,
      gateReason: extractions.gateReason,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), inArray(rawItems.sourceType, ["personal_email", "sms"])));

  const byMail = new Map<string, Mail>();
  for (const row of rows) {
    const json = (row.json ?? {}) as Record<string, unknown>;
    const flagged = json.calendar_event_suggested === true || json.todo_suggested === true;
    if (!row.gatePassed && !(row.gateReason === "automated_low_urgency" && flagged)) continue;

    const existing = byMail.get(row.rawItemId);
    if (existing) {
      existing.extractionIds.push(row.extractionId);
      continue;
    }
    byMail.set(row.rawItemId, {
      shortId: `m${byMail.size + 1}`,
      extractionIds: [row.extractionId],
      sourceType: row.sourceType,
      receivedAt: row.receivedAt,
      text: stripControlChars(row.rawContent ?? "").slice(0, MAIL_CHARS),
      classification: {
        type: json.type ?? null,
        urgency: json.urgency ?? null,
        deadline: json.deadline ?? null,
        action_required: json.action_required ?? null,
      },
    });
  }
  return [...byMail.values()];
}

/** Every open task, not the 40 Phase 3 ranks for Section 2: "already on the list" needs the whole list. */
async function openTodos(runDate: string): Promise<TodoItem[]> {
  const rows = await db
    .select({ rawContent: rawItems.rawContent })
    .from(rawItems)
    .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "todo")));
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.rawContent ?? "") as TodoItem];
    } catch {
      return [];
    }
  });
}

/** An instant as the wall clock at home reads it: "2026-09-30T14:00". */
function wallClock(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: HOME_TIME_ZONE }).slice(0, 16).replace(" ", "T");
}

function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** The first and last local day an event covers. A whole-day event's `end` is exclusive. */
function eventDays(event: CalendarEvent): [string, string] {
  if (event.is_all_day) {
    const last = event.end ? addDays(event.end, -1) : event.start;
    return [event.start, last >= event.start ? last : event.start];
  }
  return [localDay(event.start), localDay(event.end || event.start)];
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );
}

/**
 * Loose on purpose: a false "already there" costs a button the reader can do without, a false
 * "not there yet" puts a duplicate into their calendar or list.
 */
function similar(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return false;
  let common = 0;
  for (const w of left) if (right.has(w)) common++;
  return common / Math.min(left.size, right.size) >= 0.6;
}

interface When {
  allDay: boolean;
  /** Instant, or a date for a whole-day event. */
  start: string;
  /** Instant, or the last day inclusive. */
  end: string;
}

/** The model's local start and end as a `When`, defaulting a missing end to an hour or a day. */
function parseWhen(start: string, end: string): When | null {
  const s = start.trim();
  const e = end.trim();
  if (isLocalDate(s)) {
    return { allDay: true, start: s, end: isLocalDate(e) && e >= s ? e : s };
  }
  const startIso = zonedToIso(s);
  if (!startIso) return null;
  const endIso = e ? zonedToIso(e) : null;
  return {
    allDay: false,
    start: startIso,
    end: endIso && endIso > startIso ? endIso : new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  };
}

function whenOf(event: CalendarEvent): When {
  if (event.is_all_day) {
    const [first, last] = eventDays(event);
    return { allDay: true, start: first, end: last };
  }
  return { allDay: false, start: new Date(event.start).toISOString(), end: new Date(event.end || event.start).toISOString() };
}

/** What the calendar skills take: instants as they are, a whole-day end as the exclusive next day. */
function skillTimes(when: When): { start: string; end: string } {
  return when.allDay ? { start: when.start, end: addDays(when.end, 1) } : { start: when.start, end: when.end };
}

function isPast(when: When, now: Date): boolean {
  return when.allDay ? when.end < localDay(now.toISOString()) : when.end <= now.toISOString();
}

function firstDay(when: When): string {
  return when.allDay ? when.start : localDay(when.start);
}

/** The calendar on one day, from the API; the ingested week if the API does not answer. */
async function eventsOn(day: string, ingested: CalendarEvent[], cache: Map<string, Promise<CalendarEvent[]>>) {
  let pending = cache.get(day);
  if (!pending) {
    pending = listCalendarEvents(zonedToIso(`${day}T00:00`)!, zonedToIso(`${addDays(day, 1)}T00:00`)!).catch((err) => {
      console.warn(`[Actions] Calendar lookup for ${day} failed, checking the ingested week only: ${err instanceof Error ? err.message : err}`);
      return ingested.filter((event) => {
        const [first, last] = eventDays(event);
        return first <= day && day <= last;
      });
    });
    cache.set(day, pending);
  }
  return pending;
}

function inCalendar(title: string, when: When, events: CalendarEvent[]): boolean {
  const day = firstDay(when);
  return events.some((event) => {
    const [first, last] = eventDays(event);
    if (day < first || day > last) return false;
    if (similar(title, event.title)) return true;
    // Two different things rarely start within half an hour of each other on the same day.
    return !when.allDay && !event.is_all_day && Math.abs(Date.parse(event.start) - Date.parse(when.start)) <= 30 * 60_000;
  });
}

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

/**
 * One line, capped, and without links. A link copied from a mail into the owner's own calendar
 * or to-do list reads as one they put there themselves, which is exactly the trust a phishing
 * link is after; the prompt says so too, and this holds when it is not obeyed.
 */
const clean = (text: string, max: number) =>
  text.replace(LINK, "(link in the mail)").replace(/\s+/g, " ").trim().slice(0, max);

interface Refs {
  mails: Map<string, Mail>;
  events: Map<string, CalendarEvent>;
  tasks: Map<string, TodoItem>;
  ingestedCalendar: CalendarEvent[];
  openTasks: TodoItem[];
  calendarByDay: Map<string, Promise<CalendarEvent[]>>;
  now: Date;
}

type Checked =
  | { ok: true; parameters: Record<string, unknown>; preview: ActionPreview }
  | { ok: false; reason: DiscardReason; preview: ActionPreview };

/** What the model said, shaped as a preview, for a discarded row nobody will ever render. */
function rawPreview(action: ModelAction): ActionPreview {
  switch (action.kind) {
    case "add_todo":
      return { kind: "add_todo", title: action.title, due: action.due || null, notes: action.notes || null };
    case "complete_todo":
      return { kind: "complete_todo", title: action.task_id, list: "" };
    default:
      return { kind: "add_event", title: action.title || action.event_id, start: action.start, end: action.end, allDay: isLocalDate(action.start), location: action.location || null };
  }
}

async function check(action: ModelAction, refs: Refs): Promise<Checked> {
  const discard = (reason: DiscardReason): Checked => ({ ok: false, reason, preview: rawPreview(action) });
  const title = clean(action.title, 120);
  const location = clean(action.location, 200) || null;
  const notes = clean(action.notes, 300) || null;

  switch (action.kind) {
    case "add_event": {
      if (!title) return discard("empty_title");
      const when = parseWhen(action.start, action.end);
      if (!when) return discard("bad_time");
      if (isPast(when, refs.now)) return discard("in_past");
      const onDay = await eventsOn(firstDay(when), refs.ingestedCalendar, refs.calendarByDay);
      if (inCalendar(title, when, onDay)) return discard("already_in_calendar");
      return {
        ok: true,
        parameters: {
          title,
          ...skillTimes(when),
          ...(location ? { location } : {}),
          ...(notes ? { description: notes } : {}),
        },
        preview: { kind: "add_event", title, ...when, location },
      };
    }

    case "update_event": {
      const event = refs.events.get(action.event_id.trim());
      if (!event) return discard("unknown_event");
      const was = whenOf(event);
      let when = was;
      if (action.start.trim()) {
        const parsed = parseWhen(action.start, action.end);
        if (!parsed) return discard("bad_time");
        // A new start without an end keeps the event's length rather than the one-hour default.
        when = action.end.trim() || parsed.allDay !== was.allDay || was.allDay
          ? parsed
          : { ...parsed, end: new Date(Date.parse(parsed.start) + Date.parse(was.end) - Date.parse(was.start)).toISOString() };
      }
      if (isPast(when, refs.now)) return discard("in_past");

      const moved = when.start !== was.start || when.end !== was.end || when.allDay !== was.allDay;
      const relocated = location !== null && location !== (event.location ?? null);
      const renamed = title !== "" && title !== event.title;
      if (!moved && !relocated && !renamed) return discard("no_change");

      return {
        ok: true,
        parameters: {
          event_id: event.id,
          ...(moved ? skillTimes(when) : {}),
          ...(relocated ? { location } : {}),
          ...(renamed ? { title } : {}),
        },
        preview: {
          kind: "update_event",
          title: renamed ? title : event.title,
          ...when,
          location: relocated ? location : event.location,
          was: { ...was, location: event.location },
        },
      };
    }

    case "add_todo": {
      if (!title) return discard("empty_title");
      if (refs.openTasks.some((task) => similar(title, task.title))) return discard("already_on_list");
      const due = isLocalDate(action.due.trim()) ? action.due.trim() : null;
      return {
        ok: true,
        parameters: { title, ...(notes ? { notes } : {}), ...(due ? { due } : {}) },
        preview: { kind: "add_todo", title, due, notes },
      };
    }

    case "complete_todo": {
      const task = refs.tasks.get(action.task_id.trim());
      if (!task) return discard("unknown_task");
      return {
        ok: true,
        // By list name: that is what the ingest keeps, and `resolveTaskList` takes either.
        parameters: { task_id: task.id, list_id: task.list_name },
        preview: { kind: "complete_todo", title: task.title, list: task.list_name },
      };
    }
  }
}

type Comparable = Pick<Proposal, "kind" | "parameters" | "preview">;

/** Two proposals for the same thing: the same kind about the same event, task or title. */
export function sameThing(a: Comparable, b: Comparable): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "complete_todo" || a.kind === "update_event") {
    const key = a.kind === "complete_todo" ? "task_id" : "event_id";
    return a.parameters[key] === b.parameters[key];
  }
  return similar(a.preview.title, b.preview.title);
}

export interface QuickActionsResult {
  proposals: Proposal[];
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
}

/**
 * What the agent reads from Phase 3. Narrow on purpose, so `scripts/actions-dry-run.ts` can build
 * it without running Phase 3, which writes gate verdicts and spends web searches.
 */
export type ActionInputs = Pick<ContextPayload, "calendarItems" | "notesPersonal" | "longTermContext">;

/** The proposals for a run, offered and discarded alike. Makes no call on a day without candidates. */
export async function proposeQuickActions(ctx: ActionInputs, runDate: string): Promise<QuickActionsResult> {
  const mails = await candidateMails(runDate);
  if (mails.length === 0) {
    console.log("[Actions] No personal mail to act on");
    return { proposals: [], tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  }

  const openTasks = await openTodos(runDate);
  const events = new Map(ctx.calendarItems.map((event, i) => [`c${i + 1}`, event]));
  const tasks = new Map(openTasks.map((task, i) => [`t${i + 1}`, task]));

  const payload = {
    today: `${runDate} (${weekday(runDate)})`,
    time_zone: HOME_TIME_ZONE,
    mails: mails.map((mail) => ({
      id: mail.shortId,
      kind: mail.sourceType === "sms" ? "sms" : "email",
      received: mail.receivedAt ? `${wallClock(mail.receivedAt).replace("T", " ")} (${weekday(localDay(mail.receivedAt))})` : null,
      classification: mail.classification,
      text: mail.text,
    })),
    calendar: [...events].map(([id, event]) => ({
      id,
      title: event.title,
      start: event.is_all_day ? event.start : wallClock(event.start),
      end: event.is_all_day ? eventDays(event)[1] : wallClock(event.end || event.start),
      all_day: event.is_all_day,
      location: event.location,
    })),
    todos: [...tasks].map(([id, task]) => ({ id, title: task.title, due: task.due, list: task.list_name })),
    // Personal scope only: global notes carry the weekly meta-run's prompt proposals, which are
    // not instructions about the reader's mail.
    instructions: [
      ...ctx.notesPersonal.filter((note) => note.scope === "personal").map((note) => note.content),
      ...ctx.longTermContext.standingRules.map((rule) => rule.value),
    ],
  };

  const prompt = await activePrompt("quick_actions");
  let tokensIn = 0;
  let tokensOut = 0;
  const answer = await extractJson<{ actions: ModelAction[] }>(prompt.text, JSON.stringify(payload), {
    schema: ACTIONS_SCHEMA,
    // Judgement is the whole job here, and a wrong "yes" is the failure that matters.
    reasoningEffort: "medium",
    maxOutputTokens: 6000,
    onUsage: (inTokens, outTokens) => {
      tokensIn += inTokens;
      tokensOut += outTokens;
    },
  });

  const refs: Refs = {
    mails: new Map(mails.map((mail) => [mail.shortId, mail])),
    events,
    tasks,
    ingestedCalendar: ctx.calendarItems,
    openTasks,
    calendarByDay: new Map(),
    now: new Date(),
  };

  const proposals: Proposal[] = [];
  const perMail = new Map<string, number>();
  let offered = 0;

  for (const action of answer.actions) {
    const sources = [...new Set(action.mail_ids.map((id) => id.trim()))].filter((id) => refs.mails.has(id));
    const sourceExtractionIds = sources.flatMap((id) => refs.mails.get(id)!.extractionIds);
    const base = { kind: action.kind, skillName: SKILL_FOR[action.kind], reason: clean(action.why, 200), sourceExtractionIds };

    const checked: Checked = sources.length === 0
      ? { ok: false, reason: "unknown_mail", preview: rawPreview(action) }
      : await check(action, refs);

    if (!checked.ok) {
      proposals.push({ ...base, parameters: { ...action }, preview: checked.preview, discarded: checked.reason });
      continue;
    }

    const proposal: Proposal = { ...base, parameters: checked.parameters, preview: checked.preview, discarded: null };
    const discarded: DiscardReason | null =
      proposals.some((p) => p.discarded === null && sameThing(p, proposal)) ? "duplicate"
      : sources.some((id) => (perMail.get(id) ?? 0) >= MAX_PER_MAIL) ? "per_mail_cap"
      : offered >= MAX_ACTIONS ? "daily_cap"
      : null;

    if (discarded === null) {
      offered++;
      for (const id of sources) perMail.set(id, (perMail.get(id) ?? 0) + 1);
    }
    proposals.push({ ...proposal, discarded });
  }

  const dropped = proposals.filter((p) => p.discarded !== null);
  console.log(
    `[Actions] ${mails.length} mail(s) read, ${answer.actions.length} action(s) proposed, ${offered} offered` +
      (dropped.length > 0 ? `, ${dropped.length} discarded (${dropped.map((p) => p.discarded).join(", ")})` : ""),
  );

  return { proposals, tokensIn, tokensOut, aiCalls: 1 };
}
