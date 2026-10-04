import { errMessage } from "../util/text";
import { google, type calendar_v3 } from "googleapis";
import { googleAuth } from "./google-client";
import { db, rawItems, rawItemExists } from "../db";
import { timeZoneOrUtc, DAY_MS } from "../util/time";

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

export function getCalendarClient() {
  return google.calendar({ version: "v3", auth: googleAuth() });
}

let primaryZone: Promise<string> | undefined;

/**
 * The primary calendar's own zone, which is what a time read out of a mail means when no browser
 * is attached (the unattended pipeline). Cached for the process; UTC when Google does not say, and
 * that fallback is not cached, so the next call asks again.
 */
export function calendarTimeZone(): Promise<string> {
  primaryZone ??= Promise.resolve()
    .then(() => getCalendarClient().calendars.get({ calendarId: "primary" }))
    .then((res) => timeZoneOrUtc(res.data.timeZone))
    .catch((err) => {
      primaryZone = undefined;
      console.warn(`[Ingest/Google] calendar time zone unavailable, using UTC: ${errMessage(err)}`);
      return "UTC";
    });
  return primaryZone;
}

export function getTasksClient() {
  return google.tasks({ version: "v1", auth: googleAuth() });
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

  const tasks = getTasksClient();
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
  const response = await getCalendarClient().events.list({
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

/**
 * A snapshot, not an append log: the key carries no run date, so an event or task still open is
 * refreshed in place instead of costing a fresh row every morning (a task per day was 171 rows, ~62k
 * a year, and nothing reads a past day's snapshot). One that completes or drops out of the window
 * simply stops being refreshed and falls out of Phase 3's `run_date = today` read on its own.
 */
async function upsertSnapshot(
  runDate: string,
  sourceType: "calendar" | "todo",
  sourceName: string,
  messageId: string,
  content: CalendarEvent | TodoItem,
  receivedAt: string | null | undefined,
): Promise<void> {
  const rawContent = JSON.stringify(content);
  await db
    .insert(rawItems)
    .values({ runDate, sourceType, sourceName, messageId, rawContent, receivedAt: receivedAt ?? null })
    .onConflictDoUpdate({ target: rawItems.messageId, set: { runDate, rawContent, receivedAt: receivedAt ?? null } });
}

export async function ingestGoogleCalendar(runDate: string): Promise<number> {
  const calendar = getCalendarClient();

  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * DAY_MS);

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

    await upsertSnapshot(runDate, "calendar", "Google Calendar", `calendar:${event.id}`, toCalendarEvent({ ...event, id: event.id }), event.created);
    stored++;
  }

  console.log(`[Ingest/Google] ${stored} calendar events`);
  return stored;
}

export async function ingestGoogleTasks(runDate: string): Promise<number> {
  const tasks = getTasksClient();

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

        await upsertSnapshot(runDate, "todo", "Google Tasks", `todo:${task.id}`, content, task.updated);
        stored++;
      }

      pageToken = tasksResponse.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  console.log(`[Ingest/Google] ${stored} open tasks in today's snapshot`);
  return stored;
}
