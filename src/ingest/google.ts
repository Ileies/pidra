import { google } from "googleapis";
import { db, rawItems } from "../db";
import { eq } from "drizzle-orm";

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

    const messageId = `calendar:${runDate}:${event.id}`;

    const existing = await db
      .select({ id: rawItems.id })
      .from(rawItems)
      .where(eq(rawItems.messageId, messageId))
      .limit(1);
    if (existing.length > 0) continue;

    const isAllDay = !event.start?.dateTime;
    const content: CalendarEvent = {
      id: event.id,
      title: event.summary ?? "(no title)",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      location: event.location ?? null,
      description: event.description ?? null,
      attendees: (event.attendees ?? []).map((a) => a.email!).filter(Boolean),
      is_all_day: isAllDay,
    };

    await db.insert(rawItems).values({
      runDate,
      sourceType: "calendar",
      sourceName: "Google Calendar",
      messageId,
      rawContent: JSON.stringify(content),
      receivedAt: event.created ?? null,
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

    const tasksResponse = await tasks.tasks.list({
      tasklist: list.id,
      showCompleted: false,
      showHidden: false,
      maxResults: 100,
    });

    for (const task of tasksResponse.data.items ?? []) {
      if (!task.id || task.status === "completed") continue;

      const messageId = `todo:${runDate}:${task.id}`;

      const existing = await db
        .select({ id: rawItems.id })
        .from(rawItems)
        .where(eq(rawItems.messageId, messageId))
        .limit(1);
      if (existing.length > 0) continue;

      const content: TodoItem = {
        id: task.id,
        title: task.title ?? "(no title)",
        notes: task.notes ?? null,
        due: task.due ? task.due.split("T")[0] : null,
        list_name: list.title ?? "Tasks",
        status: task.status ?? "needsAction",
      };

      await db.insert(rawItems).values({
        runDate,
        sourceType: "todo",
        sourceName: "Google Tasks",
        messageId,
        rawContent: JSON.stringify(content),
        receivedAt: task.updated ?? null,
      });

      stored++;
    }
  }

  console.log(`[Ingest/Google] ${stored} tasks`);
  return stored;
}
