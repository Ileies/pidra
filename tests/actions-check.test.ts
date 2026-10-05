// src/actions/propose/check.ts: the code-side gate every model-proposed quick action passes before
// it becomes a button. The model is not trusted: links are stripped, duplicates, past events and
// references to things that do not exist are thrown out with a reason, and what survives is the
// exact skill parameters a tap will run. The calendar day is pre-filled in `calendarByDay`, so no
// lookup reaches the API; `googleapis` is a stand-in only for the import chain.
import { describe, expect, mock, test } from "bun:test";
import { dbModule } from "./fixtures/db";
import { googleapisModule } from "./fixtures/googleapis";

mock.module("../src/db", () => dbModule({}));
mock.module("googleapis", () => googleapisModule);

const { check, clean, rawPreview } = await import("../src/actions/propose/check");
type Refs = import("../src/actions/propose/check").Refs;
type ModelAction = import("../src/actions/propose/types").ModelAction;
type CalendarEvent = import("../src/ingest/google").CalendarEvent;
type TodoItem = import("../src/ingest/google").TodoItem;

const ZONE = "Europe/Berlin";
const NOW = new Date("2026-10-05T10:00:00Z");

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "ev1",
  title: "Team sync",
  start: "2026-10-08T08:00:00.000Z",
  end: "2026-10-08T09:00:00.000Z",
  location: null,
  description: null,
  attendees: [],
  is_all_day: false,
  ...over,
});
const task = (over: Partial<TodoItem> = {}): TodoItem => ({ id: "t1", title: "Call the bank", notes: null, due: null, list_name: "To-Do Now", status: "needsAction", ...over });

/** The day the proposed event falls on, answered from the cache instead of the API. */
function refs(over: { onDay?: CalendarEvent[]; day?: string; events?: CalendarEvent[]; tasks?: TodoItem[]; openTasks?: TodoItem[] } = {}): Refs {
  const cache = new Map<string, Promise<CalendarEvent[]>>();
  cache.set(over.day ?? "2026-10-08", Promise.resolve(over.onDay ?? []));
  const events = over.events ?? [event()];
  const tasks = over.tasks ?? [task()];
  return {
    mails: new Map(),
    events: new Map(events.map((e) => [e.id, e])),
    tasks: new Map(tasks.map((t) => [t.id, t])),
    ingestedCalendar: events,
    openTasks: over.openTasks ?? tasks,
    calendarByDay: cache,
    now: NOW,
    zone: ZONE,
  };
}

const action = (over: Partial<ModelAction>): ModelAction => ({
  kind: "add_event",
  mail_ids: ["m1"],
  why: "from a mail",
  title: "",
  start: "",
  end: "",
  location: "",
  notes: "",
  due: "",
  event_id: "",
  task_id: "",
  ...over,
});

describe("clean", () => {
  test("replaces links with a marker so a mail's link never looks like the owner's own", () => {
    expect(clean("Pay at https://pay.example.com/x?id=1 today", 200)).toBe("Pay at (link in the mail) today");
    expect(clean("See www.example.com/offer and HTTP://EXAMPLE.COM", 200)).toBe("See (link in the mail) and (link in the mail)");
  });

  test("collapses whitespace to one line and caps the length", () => {
    expect(clean("  a\n\n b \t c  ", 50)).toBe("a b c");
    expect(clean("abcdefghij", 4)).toBe("abcd");
  });
});

describe("rawPreview", () => {
  test("shapes what the model said as a preview of the matching kind", () => {
    expect(rawPreview(action({ kind: "add_todo", title: "T", due: "2026-10-09", notes: "n" }))).toEqual({ kind: "add_todo", title: "T", due: "2026-10-09", notes: "n" });
    expect(rawPreview(action({ kind: "add_todo", title: "T" }))).toEqual({ kind: "add_todo", title: "T", due: null, notes: null });
    expect(rawPreview(action({ kind: "complete_todo", task_id: "t9" }))).toMatchObject({ kind: "complete_todo", title: "t9" });
    expect(rawPreview(action({ kind: "add_event", title: "E", start: "2026-10-09", end: "", location: "Room" }))).toEqual({ kind: "add_event", title: "E", start: "2026-10-09", end: "", allDay: true, location: "Room" });
    expect(rawPreview(action({ kind: "update_event", event_id: "ev9", start: "2026-10-09T10:00" }))).toMatchObject({ kind: "add_event", title: "ev9", allDay: false });
  });
});

describe("check: add_event", () => {
  const add = (over: Partial<ModelAction>) => action({ kind: "add_event", title: "Dentist", start: "2026-10-08T10:00", end: "2026-10-08T11:00", ...over });

  test("a valid event becomes skill parameters in UTC and a preview of the same times", async () => {
    const result = await check(add({ location: "Main St 1", notes: "Bring the card" }), refs());
    expect(result).toEqual({
      ok: true,
      parameters: { title: "Dentist", start: "2026-10-08T08:00:00.000Z", end: "2026-10-08T09:00:00.000Z", location: "Main St 1", description: "Bring the card" },
      preview: { kind: "add_event", title: "Dentist", allDay: false, start: "2026-10-08T08:00:00.000Z", end: "2026-10-08T09:00:00.000Z", location: "Main St 1" },
    });
  });

  test("optional fields are left out of the parameters when empty", async () => {
    const result = await check(add({}), refs());
    expect(result.ok && Object.keys(result.parameters).sort()).toEqual(["end", "start", "title"]);
  });

  test("a whole-day event gets the exclusive next day for the skill and an inclusive end in the preview", async () => {
    const result = await check(add({ start: "2026-10-08", end: "2026-10-09" }), refs());
    expect(result).toMatchObject({ ok: true, parameters: { start: "2026-10-08", end: "2026-10-10" }, preview: { allDay: true, start: "2026-10-08", end: "2026-10-09" } });
  });

  test("links in the title, location and notes are replaced before anything is stored", async () => {
    const result = await check(add({ title: "Claim prize https://evil.example.com", location: "www.evil.example.com", notes: "go to http://evil.example.com now" }), refs());
    expect(result).toMatchObject({
      ok: true,
      parameters: { title: "Claim prize (link in the mail)", location: "(link in the mail)", description: "go to (link in the mail) now" },
    });
    expect(JSON.stringify(result)).not.toContain("evil.example.com");
  });

  test("throws out an empty title, an unreadable time and a past event, each with its reason", async () => {
    expect(await check(add({ title: "   " }), refs())).toMatchObject({ ok: false, reason: "empty_title" });
    expect(await check(add({ start: "next tuesday" }), refs())).toMatchObject({ ok: false, reason: "bad_time" });
    expect(await check(add({ start: "2026-10-05T09:00", end: "2026-10-05T10:00" }), refs({ day: "2026-10-05" }))).toMatchObject({ ok: false, reason: "in_past" });
    expect(await check(add({ start: "2026-10-04", end: "" }), refs({ day: "2026-10-04" }))).toMatchObject({ ok: false, reason: "in_past" });
  });

  test("an event later today is not past, and a whole-day event today is not past either", async () => {
    expect((await check(add({ start: "2026-10-05T18:00", end: "2026-10-05T19:00" }), refs({ day: "2026-10-05" }))).ok).toBe(true);
    expect((await check(add({ start: "2026-10-05", end: "" }), refs({ day: "2026-10-05" }))).ok).toBe(true);
  });

  test("throws out an event that is already in the calendar, by similar title or by start time", async () => {
    const same = event({ id: "x", title: "Dentist appointment", start: "2026-10-08T14:00:00Z", end: "2026-10-08T15:00:00Z" });
    expect(await check(add({}), refs({ onDay: [same] }))).toMatchObject({ ok: false, reason: "already_in_calendar" });
    const sameTime = event({ id: "y", title: "Something unrelated", start: "2026-10-08T08:10:00Z", end: "2026-10-08T09:00:00Z" });
    expect(await check(add({}), refs({ onDay: [sameTime] }))).toMatchObject({ ok: false, reason: "already_in_calendar" });
    const elsewhere = event({ id: "z", title: "Something unrelated", start: "2026-10-08T14:00:00Z", end: "2026-10-08T15:00:00Z" });
    expect((await check(add({}), refs({ onDay: [elsewhere] }))).ok).toBe(true);
  });

  test("a discarded event keeps what the model said as its preview", async () => {
    const result = await check(add({ title: "Dentist", start: "garbled" }), refs());
    expect(result).toMatchObject({ ok: false, reason: "bad_time", preview: { kind: "add_event", title: "Dentist", start: "garbled" } });
  });
});

describe("check: update_event", () => {
  const update = (over: Partial<ModelAction>) => action({ kind: "update_event", event_id: "ev1", ...over });

  test("an unknown event is thrown out, and the id is trimmed before the lookup", async () => {
    expect(await check(update({ event_id: "nope", location: "Room 2" }), refs())).toMatchObject({ ok: false, reason: "unknown_event" });
    expect((await check(update({ event_id: " ev1 ", location: "Room 2" }), refs())).ok).toBe(true);
  });

  test("a new start without an end keeps the event's length instead of the one-hour default", async () => {
    const long = event({ start: "2026-10-08T08:00:00.000Z", end: "2026-10-08T10:30:00.000Z" });
    const result = await check(update({ start: "2026-10-09T10:00" }), refs({ events: [long] }));
    expect(result).toMatchObject({
      ok: true,
      parameters: { event_id: "ev1", start: "2026-10-09T08:00:00.000Z", end: "2026-10-09T10:30:00.000Z" },
      preview: { was: { start: "2026-10-08T08:00:00.000Z", end: "2026-10-08T10:30:00.000Z" } },
    });
  });

  test("a new start with an end uses both", async () => {
    const result = await check(update({ start: "2026-10-09T10:00", end: "2026-10-09T10:20" }), refs());
    expect(result).toMatchObject({ ok: true, parameters: { start: "2026-10-09T08:00:00.000Z", end: "2026-10-09T08:20:00.000Z" } });
  });

  test("only what changed is passed: a rename alone and a new place alone", async () => {
    const renamed = await check(update({ title: "Team retro" }), refs());
    expect(renamed).toMatchObject({ ok: true, parameters: { event_id: "ev1", title: "Team retro" }, preview: { title: "Team retro" } });
    expect(renamed.ok && Object.keys(renamed.parameters).sort()).toEqual(["event_id", "title"]);

    const moved = await check(update({ location: "Room 2" }), refs());
    expect(moved.ok && Object.keys(moved.parameters).sort()).toEqual(["event_id", "location"]);
  });

  test("a no-op, a same title or the same time is no_change", async () => {
    expect(await check(update({}), refs())).toMatchObject({ ok: false, reason: "no_change" });
    expect(await check(update({ title: "Team sync" }), refs())).toMatchObject({ ok: false, reason: "no_change" });
    expect(await check(update({ start: "2026-10-08T10:00", end: "2026-10-08T11:00" }), refs())).toMatchObject({ ok: false, reason: "no_change" });
    const located = event({ location: "Room 1" });
    expect(await check(update({ location: "Room 1" }), refs({ events: [located] }))).toMatchObject({ ok: false, reason: "no_change" });
  });

  test("an unreadable new time is bad_time, and moving an event into the past is in_past", async () => {
    expect(await check(update({ start: "whenever" }), refs())).toMatchObject({ ok: false, reason: "bad_time" });
    expect(await check(update({ start: "2026-10-01T10:00", end: "2026-10-01T11:00" }), refs())).toMatchObject({ ok: false, reason: "in_past" });
  });

  test("an event that has already ended cannot be updated, even without a new time", async () => {
    const over = event({ start: "2026-10-01T08:00:00.000Z", end: "2026-10-01T09:00:00.000Z" });
    expect(await check(update({ location: "Room 2" }), refs({ events: [over] }))).toMatchObject({ ok: false, reason: "in_past" });
  });
});

describe("check: add_todo", () => {
  const add = (over: Partial<ModelAction>) => action({ kind: "add_todo", title: "Renew the passport", ...over });

  test("a valid task keeps a real due date and drops a malformed one", async () => {
    expect(await check(add({ due: "2026-10-20", notes: "bring photos" }), refs())).toEqual({
      ok: true,
      parameters: { title: "Renew the passport", notes: "bring photos", due: "2026-10-20" },
      preview: { kind: "add_todo", title: "Renew the passport", due: "2026-10-20", notes: "bring photos" },
    });
    expect(await check(add({ due: "2026-02-31" }), refs())).toMatchObject({ ok: true, preview: { due: null } });
    expect(await check(add({ due: "soon" }), refs())).toMatchObject({ ok: true, parameters: { title: "Renew the passport" }, preview: { due: null } });
  });

  test("an empty title is thrown out, and so is a task already on the open list", async () => {
    expect(await check(add({ title: "" }), refs())).toMatchObject({ ok: false, reason: "empty_title" });
    expect(await check(add({ title: "Renew passport" }), refs({ openTasks: [task({ title: "Renew the passport" })] }))).toMatchObject({ ok: false, reason: "already_on_list" });
    expect((await check(add({ title: "Renew passport" }), refs({ openTasks: [task({ title: "Buy groceries" })] }))).ok).toBe(true);
  });

  test("links are stripped from the title and notes", async () => {
    const result = await check(add({ title: "Reset https://evil.example.com/reset", notes: "www.evil.example.com" }), refs());
    expect(JSON.stringify(result)).not.toContain("evil.example.com");
  });
});

describe("check: complete_todo", () => {
  const complete = (task_id: string) => action({ kind: "complete_todo", task_id });

  test("a known task completes by id and list name, and the id is trimmed", async () => {
    expect(await check(complete(" t1 "), refs())).toEqual({
      ok: true,
      parameters: { task_id: "t1", list_id: "To-Do Now" },
      preview: { kind: "complete_todo", title: "Call the bank", list: "To-Do Now" },
    });
  });

  test("an unknown task is thrown out", async () => {
    expect(await check(complete("t99"), refs())).toMatchObject({ ok: false, reason: "unknown_task" });
    expect(await check(complete(""), refs())).toMatchObject({ ok: false, reason: "unknown_task" });
  });
});
