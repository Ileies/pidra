import { google, type calendar_v3 } from "googleapis";
import { db, rawItems, rawItemExists } from "../db";
import { isLocalDate, timeZoneOrUtc, zonedToIso } from "../util/time";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  attendees: string[];
  is_all_day: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  notes: string | null;
  due: string | null;
  list_name: string;
  status: string;
}

function createAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

export async function getCalendarClient() {
  return google.calendar({ version: "v3", auth: createAuthClient() });
}

let primaryZone: Promise<string> | undefined;

/**
 * The primary calendar's own zone, which is what a time read out of a mail means when no browser
 * is attached (the unattended pipeline). Cached for the process; UTC when Google does not say, and
 * that fallback is not cached, so the next call asks again.
 */
export function calendarTimeZone(): Promise<string> {
  primaryZone ??= getCalendarClient()
    .then((calendar) => calendar.calendars.get({ calendarId: "primary" }))
    .then((res) => timeZoneOrUtc(res.data.timeZone))
    .catch((err) => {
      primaryZone = undefined;
      console.warn(`[Ingest/Google] calendar time zone unavailable, using UTC: ${err instanceof Error ? err.message : err}`);
      return "UTC";
    });
  return primaryZone;
}

export async function getTasksClient() {
  return google.tasks({ version: "v1", auth: createAuthClient() });
}

/**
 * The list that system-created tasks land in when the caller names none. "To-Do Now" is the
 * list the owner actually checks daily (decided 2026-09-10); system items come from email
 * deadlines and are time-sensitive, so the project backlog is the wrong place for them.
 *
 * Configured as a list *title*, not an id: list ids are opaque per-account strings, so
 * hardcoding one would be meaningless in any other account, and the only portable id the API
 * offers is `@default`, which is whatever list happens to be first.
 */
function defaultTaskListTitle(): string {
  return process.env.GOOGLE_TASKS_DEFAULT_LIST?.trim() || "To-Do Now";
}

// Titles are stable enough to cache for the life of the process, and only hits are cached, so
// a list created after startup is still found on the next lookup.
const taskListIds = new Map<string, string>();

async function taskListIdByTitle(title: string): Promise<string | null> {
  const key = title.toLowerCase();
  const cached = taskListIds.get(key);
  if (cached) return cached;

  const tasks = await getTasksClient();
  for (const list of (await tasks.tasklists.list({ maxResults: 50 })).data.items ?? []) {
    if (list.id && list.title) taskListIds.set(list.title.toLowerCase(), list.id);
  }
  return taskListIds.get(key) ?? null;
}

/**
 * Turn whatever a caller supplied into a tasklist id. Accepts a title as readily as an id,
 * because the assistant knows the lists by name and never by id. An unknown value is passed
 * through unchanged so a real id still works, and a missing default falls back to `@default`
 * rather than failing the write.
 */
export async function resolveTaskList(requested?: string | null): Promise<string> {
  const wanted = requested?.trim();
  if (wanted === "@default") return wanted;
  if (wanted) return (await taskListIdByTitle(wanted)) ?? wanted;

  const title = defaultTaskListTitle();
  const id = await taskListIdByTitle(title);
  if (id) return id;

  console.warn(`[Ingest/Google] no tasklist named "${title}", falling back to @default`);
  return "@default";
}

/**
 * A skill's start or end as the Calendar API takes it: `YYYY-MM-DD` is a whole-day `date`,
 * anything else a `dateTime`. A time without an offset is read in `timeZone` (the caller's, not
 * the process's). The other field is sent as null so a patch can turn a timed event into a
 * whole-day one and back.
 */
export function eventTime(value: string, timeZone: string): calendar_v3.Schema$EventDateTime {
  const trimmed = value.trim();
  if (isLocalDate(trimmed)) return { date: trimmed, dateTime: null, timeZone };
  const iso = zonedToIso(trimmed, timeZone) ?? (Number.isNaN(Date.parse(trimmed)) ? null : new Date(trimmed).toISOString());
  if (!iso) throw new Error(`Not a date or time: "${value}"`);
  return { dateTime: iso, date: null, timeZone };
}

/** An integer parameter from the model, clamped to `[min, max]`, or `fallback` when omitted. */
export function intParam(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} must be a whole number`);
  return Math.min(max, Math.max(min, n));
}

/** Booleans arrive as `true`, `"true"` or `"yes"` depending on how the model phrased the call. */
export function boolParam(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || /^(true|yes|1)$/i.test(String(value));
}

/** A comma, semicolon or whitespace separated list of email addresses, validated. */
export function emailList(value: unknown, name: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const emails = String(value).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${name}: "${email}" is not an email address`);
  }
  return [...new Set(emails)];
}

/** `all`, `externalOnly` or `none`: whether Google emails the attendees about the change. */
export function sendUpdatesParam(value: unknown): "all" | "externalOnly" | "none" {
  const v = String(value ?? "none").trim();
  if (v === "all" || v === "externalOnly" || v === "none") return v;
  throw new Error(`send_updates must be one of: all, externalOnly, none (got "${v}")`);
}

/** Refuses a destructive call when the model's idea of the title does not match the real one. */
export function assertExpectedTitle(expected: unknown, actual: string | null | undefined, kind: string): void {
  const want = String(expected ?? "").trim().toLowerCase();
  if (!want) return;
  if (!(actual ?? "").toLowerCase().includes(want)) {
    throw new Error(`Refused: that ${kind} is titled "${actual}", which does not contain expected_title "${expected}". Look it up again.`);
  }
}

/** Popup reminders, `minutes` before the start, from a comma separated list such as "10,60". */
export function reminderOverrides(value: unknown): calendar_v3.Schema$Event["reminders"] | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === "none") return { useDefault: false, overrides: [] };
  if (text === "default") return { useDefault: true };
  const minutes = text.split(/[\s,;]+/).filter(Boolean).map((m) => Number(m));
  if (minutes.some((m) => !Number.isInteger(m) || m < 0 || m > 40320)) {
    throw new Error('reminders_minutes must be whole minutes (0 to 40320) such as "10,60", or "none", or "default"');
  }
  return { useDefault: false, overrides: minutes.slice(0, 5).map((m) => ({ method: "popup", minutes: m })) };
}

function toCalendarEvent(event: calendar_v3.Schema$Event & { id: string }): CalendarEvent {
  return {
    id: event.id,
    title: event.summary ?? "(no title)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    location: event.location ?? null,
    description: event.description ?? null,
    attendees: (event.attendees ?? []).map((a) => a.email!).filter(Boolean),
    is_all_day: !event.start?.dateTime,
  };
}

/**
 * The primary calendar's events overlapping `[timeMin, timeMax)`, for a caller that needs a window
 * other than the ingest's seven days (the quick actions check a proposed event's own day).
 */
export async function listCalendarEvents(
  timeMin: string,
  timeMax: string,
  options: { calendarId?: string; query?: string; limit?: number } = {},
): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient();
  const response = await calendar.events.list({
    calendarId: options.calendarId ?? "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: options.limit ?? 50,
    q: options.query || undefined,
  });
  return (response.data.items ?? [])
    .filter((event): event is calendar_v3.Schema$Event & { id: string } => !!event.id)
    .map(toCalendarEvent);
}

export async function ingestGoogleCalendar(runDate: string): Promise<number> {
  const auth = createAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: sevenDaysLater.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const events = response.data.items ?? [];
  let stored = 0;

  for (const event of events) {
    if (!event.id) continue;

    const content = toCalendarEvent({ ...event, id: event.id });

    // Snapshot, not an append log, same shape as ingestGoogleTasks: the key carries no runDate,
    // so an event still in the 7-day window is refreshed in place instead of costing a fresh row
    // every morning. An event that drops out of the window (past, rescheduled, deleted) simply
    // stops being refreshed and falls out of Phase 3's `run_date = today` read on its own.
    await db
      .insert(rawItems)
      .values({
        runDate,
        sourceType: "calendar",
        sourceName: "Google Calendar",
        messageId: `calendar:${event.id}`,
        rawContent: JSON.stringify(content),
        receivedAt: event.created ?? null,
      })
      .onConflictDoUpdate({
        target: rawItems.messageId,
        set: {
          runDate,
          rawContent: JSON.stringify(content),
          receivedAt: event.created ?? null,
        },
      });

    stored++;
  }

  console.log(`[Ingest/Google] ${stored} calendar events`);
  return stored;
}

export async function ingestGoogleTasks(runDate: string): Promise<number> {
  const auth = createAuthClient();
  const tasks = google.tasks({ version: "v1", auth });

  const listsResponse = await tasks.tasklists.list({ maxResults: 20 });
  const lists = listsResponse.data.items ?? [];

  let stored = 0;

  for (const list of lists) {
    if (!list.id) continue;

    let pageToken: string | undefined;
    do {
      const tasksResponse = await tasks.tasks.list({
        tasklist: list.id,
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
        pageToken,
      });

      for (const task of tasksResponse.data.items ?? []) {
        if (!task.id || task.status === "completed") continue;

        const content: TodoItem = {
          id: task.id,
          title: task.title ?? "(no title)",
          notes: task.notes ?? null,
          due: task.due ? task.due.split("T")[0] : null,
          list_name: list.title ?? "Tasks",
          status: task.status ?? "needsAction",
        };

        // One row per task, refreshed to today's run date, rather than one row per task per day.
        // The old key carried `runDate`, so every open task cost a new row every morning - 171 a
        // day, roughly 62k a year, and nothing ever reads a past day's snapshot. This is a
        // snapshot of what is open right now, and `run_date` is what keeps it honest: a task that
        // was completed or deleted simply stops being refreshed, so Phase 3's `run_date = today`
        // query drops it the next morning without anything having to notice it went away.
        await db
          .insert(rawItems)
          .values({
            runDate,
            sourceType: "todo",
            sourceName: "Google Tasks",
            messageId: `todo:${task.id}`,
            rawContent: JSON.stringify(content),
            receivedAt: task.updated ?? null,
          })
          .onConflictDoUpdate({
            target: rawItems.messageId,
            set: {
              runDate,
              rawContent: JSON.stringify(content),
              receivedAt: task.updated ?? null,
            },
          });

        stored++;
      }

      pageToken = tasksResponse.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  console.log(`[Ingest/Google] ${stored} open tasks in today's snapshot`);
  return stored;
}
