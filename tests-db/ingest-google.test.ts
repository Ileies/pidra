// src/ingest/google.ts against real SQL: the calendar and tasks snapshots in `raw_items` (upserted, so a
// re-run refreshes instead of duplicating) and the task-list title lookup. Only `googleapis` is stubbed.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { googleapisModule, googleState, resetGoogleState } from "../tests/fixtures/googleapis";
import { useTestDatabase } from "./fixtures/database";

mock.module("googleapis", () => googleapisModule);

const database = await useTestDatabase();
const { db, rawItems } = await import("../src/db");
const google = await import("../src/ingest/google");

const DAY1 = "2026-10-05";
const DAY2 = "2026-10-06";

beforeEach(async () => {
  resetGoogleState();
  delete process.env.GOOGLE_TASKS_DEFAULT_LIST;
  await database.sql`truncate raw_items cascade`;
});

const rows = () => db.select().from(rawItems).orderBy(rawItems.messageId);
const content = (row: { rawContent: string | null }) => JSON.parse(row.rawContent ?? "null");

describe("ingestGoogleCalendar", () => {
  test("snapshots each event under calendar:<id> with the fields the pipeline reads", async () => {
    googleState.events = [
      { id: "e1", summary: "Dentist", start: { dateTime: "2026-10-07T09:00:00+02:00" }, end: { dateTime: "2026-10-07T09:30:00+02:00" }, location: "Main St", description: "Bring the card", attendees: [{ email: "a@example.com" }, {}, { email: "b@example.com" }], created: "2026-09-01T10:00:00.000Z" },
      { id: "e2", summary: "Holiday", start: { date: "2026-10-09" }, end: { date: "2026-10-10" } },
    ];
    expect(await google.ingestGoogleCalendar(DAY1)).toBe(2);

    const [dentist, holiday] = await rows();
    expect(dentist).toMatchObject({ runDate: DAY1, sourceType: "calendar", sourceName: "Google Calendar", messageId: "calendar:e1" });
    expect(new Date(dentist!.receivedAt!).toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(content(dentist!)).toEqual({
      id: "e1", title: "Dentist", start: "2026-10-07T09:00:00+02:00", end: "2026-10-07T09:30:00+02:00",
      location: "Main St", description: "Bring the card", attendees: ["a@example.com", "b@example.com"], is_all_day: false,
    });
    expect(content(holiday!)).toMatchObject({ title: "Holiday", start: "2026-10-09", end: "2026-10-10", is_all_day: true, location: null, attendees: [] });
    expect(holiday!.receivedAt).toBeNull();
  });

  test("asks for the next seven days, single events, at most 50", async () => {
    const before = Date.now();
    await google.ingestGoogleCalendar(DAY1);
    const [call] = googleState.listCalls;
    expect(call).toMatchObject({ calendarId: "primary", singleEvents: true, orderBy: "startTime", maxResults: 50 });
    const span = Date.parse(String(call!.timeMax)) - Date.parse(String(call!.timeMin));
    expect(span).toBe(7 * 24 * 3600 * 1000);
    expect(Date.parse(String(call!.timeMin))).toBeGreaterThanOrEqual(before - 1000);
  });

  test("an event with no id is skipped, and a title-less one is named", async () => {
    googleState.events = [{ summary: "No id", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } }, { id: "e3", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } }];
    expect(await google.ingestGoogleCalendar(DAY1)).toBe(1);
    expect(content((await rows())[0]!).title).toBe("(no title)");
  });

  test("a re-run refreshes the row in place: new run date, new content, still one row", async () => {
    googleState.events = [{ id: "e1", summary: "Dentist", start: { date: "2026-10-07" }, end: { date: "2026-10-08" } }];
    await google.ingestGoogleCalendar(DAY1);
    googleState.events = [{ id: "e1", summary: "Dentist (moved)", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } }];
    await google.ingestGoogleCalendar(DAY2);

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.runDate).toBe(DAY2);
    expect(content(all[0]!)).toMatchObject({ title: "Dentist (moved)", start: "2026-10-08" });
  });

  test("an event that left the window is not touched, so it falls out of today's read on its own", async () => {
    googleState.events = [{ id: "gone", summary: "Old", start: { date: "2026-10-07" }, end: { date: "2026-10-08" } }];
    await google.ingestGoogleCalendar(DAY1);
    googleState.events = [];
    expect(await google.ingestGoogleCalendar(DAY2)).toBe(0);
    expect((await rows()).map((r) => [r.messageId, r.runDate])).toEqual([["calendar:gone", DAY1]]);
  });

  test("an API failure propagates and stores nothing", async () => {
    googleState.eventsError = new Error("invalid_grant");
    await expect(google.ingestGoogleCalendar(DAY1)).rejects.toThrow("invalid_grant");
    expect(await rows()).toHaveLength(0);
  });
});

describe("ingestGoogleTasks", () => {
  test("snapshots open tasks across lists, with the list name and a date-only due", async () => {
    googleState.taskLists = [{ id: "L1", title: "To-Do Now" }, { id: "L2", title: "Someday" }, { title: "No id" }];
    googleState.taskPages = {
      L1: [[{ id: "t1", title: "Pay rent", notes: "IBAN in the note", due: "2026-10-08T00:00:00.000Z", status: "needsAction", updated: "2026-10-04T08:00:00.000Z" }]],
      L2: [[{ id: "t2", status: "needsAction" }]],
    };
    expect(await google.ingestGoogleTasks(DAY1)).toBe(2);

    const [t1, t2] = await rows();
    expect(t1).toMatchObject({ sourceType: "todo", sourceName: "Google Tasks", messageId: "todo:t1", runDate: DAY1 });
    expect(new Date(t1!.receivedAt!).toISOString()).toBe("2026-10-04T08:00:00.000Z");
    expect(content(t1!)).toEqual({ id: "t1", title: "Pay rent", notes: "IBAN in the note", due: "2026-10-08", list_name: "To-Do Now", status: "needsAction" });
    expect(content(t2!)).toEqual({ id: "t2", title: "(no title)", notes: null, due: null, list_name: "Someday", status: "needsAction" });
  });

  test("asks for open, non-hidden tasks only, and skips a task that is nonetheless completed", async () => {
    googleState.taskLists = [{ id: "L1", title: "A" }];
    googleState.taskPages = { L1: [[{ id: "done", title: "Done", status: "completed" }, { id: "open", title: "Open", status: "needsAction" }, { title: "no id" }]] };
    expect(await google.ingestGoogleTasks(DAY1)).toBe(1);
    expect(googleState.taskCalls[0]).toMatchObject({ tasklist: "L1", showCompleted: false, showHidden: false, maxResults: 100 });
    expect((await rows()).map((r) => r.messageId)).toEqual(["todo:open"]);
  });

  test("follows the page token until the list is exhausted", async () => {
    googleState.taskLists = [{ id: "L1", title: "A" }];
    googleState.taskPages = { L1: [[{ id: "t1", title: "one" }], [{ id: "t2", title: "two" }], [{ id: "t3", title: "three" }]] };
    expect(await google.ingestGoogleTasks(DAY1)).toBe(3);
    expect(googleState.taskCalls.map((c) => c.pageToken)).toEqual([undefined, "p1", "p2"]);
  });

  test("a task completed since the last run stops being refreshed instead of being deleted", async () => {
    googleState.taskLists = [{ id: "L1", title: "A" }];
    googleState.taskPages = { L1: [[{ id: "t1", title: "one" }, { id: "t2", title: "two" }]] };
    await google.ingestGoogleTasks(DAY1);
    googleState.taskPages = { L1: [[{ id: "t2", title: "two (edited)" }]] };
    await google.ingestGoogleTasks(DAY2);

    const byId = Object.fromEntries((await rows()).map((r) => [r.messageId, r]));
    expect(byId["todo:t1"]!.runDate).toBe(DAY1);
    expect(byId["todo:t2"]!.runDate).toBe(DAY2);
    expect(content(byId["todo:t2"]!).title).toBe("two (edited)");
  });

  test("no lists means nothing stored", async () => {
    expect(await google.ingestGoogleTasks(DAY1)).toBe(0);
    expect(await rows()).toHaveLength(0);
  });
});

describe("resolveTaskList", () => {
  // The title cache lives for the process, so every test uses titles no other test has resolved.
  test("@default and an unknown value pass through, and a title resolves to its id case-insensitively", async () => {
    googleState.taskLists = [{ id: "ID-groceries", title: "Groceries" }];
    expect(await google.resolveTaskList("@default")).toBe("@default");
    expect(googleState.taskListCalls).toBe(0);
    expect(await google.resolveTaskList("  groceries ")).toBe("ID-groceries");
    expect(await google.resolveTaskList("raw-id-123")).toBe("raw-id-123");
  });

  test("a found title is cached, a miss is looked up again so a list created later is found", async () => {
    googleState.taskLists = [{ id: "ID-cached", title: "Cached" }];
    await google.resolveTaskList("Cached");
    const calls = googleState.taskListCalls;
    await google.resolveTaskList("cached");
    expect(googleState.taskListCalls).toBe(calls);

    expect(await google.resolveTaskList("Later list")).toBe("Later list");
    googleState.taskLists = [{ id: "ID-later", title: "Later list" }];
    expect(await google.resolveTaskList("Later list")).toBe("ID-later");
  });

  test("no title asks for the configured default list, and a missing one falls back to @default", async () => {
    process.env.GOOGLE_TASKS_DEFAULT_LIST = "Inbox Zero";
    googleState.taskLists = [{ id: "ID-inbox", title: "Inbox Zero" }];
    expect(await google.resolveTaskList()).toBe("ID-inbox");
    expect(await google.resolveTaskList("   ")).toBe("ID-inbox");

    process.env.GOOGLE_TASKS_DEFAULT_LIST = "Does not exist";
    expect(await google.resolveTaskList(null)).toBe("@default");
  });
});

describe("listCalendarEvents", () => {
  test("maps events, drops ones without an id and forwards the window, query and limit", async () => {
    googleState.events = [{ id: "x", summary: "Lunch", start: { dateTime: "2026-10-07T12:00:00Z" }, end: { dateTime: "2026-10-07T13:00:00Z" } }, { summary: "ghost" }];
    const events = await google.listCalendarEvents("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", { query: "lunch", limit: 5 });
    expect(events.map((e) => e.id)).toEqual(["x"]);
    expect(googleState.listCalls[0]).toMatchObject({ timeMin: "2026-10-07T00:00:00Z", timeMax: "2026-10-08T00:00:00Z", q: "lunch", maxResults: 5, calendarId: "primary" });
  });

  test("an empty query is not sent", async () => {
    await google.listCalendarEvents("a", "b", { query: "" });
    expect(googleState.listCalls[0]!.q).toBeUndefined();
  });
});
