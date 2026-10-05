// src/actions/propose/matching.ts: the time and similarity rules behind the quick-action buttons.
// A wrong "already there" hides a button, a wrong "not there yet" puts a duplicate into the
// reader's calendar, and a wrong DST conversion puts an event an hour off. Zone is Europe/Berlin
// (DST began 2026-03-29 and ends 2026-10-25). `googleapis` is a stand-in, so the calendar lookup
// in `eventsOn` runs the real `listCalendarEvents` with no network.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbModule } from "./fixtures/db";
import { googleState, googleapisModule, resetGoogleState } from "./fixtures/googleapis";

mock.module("../src/db", () => dbModule({}));
mock.module("googleapis", () => googleapisModule);

const m = await import("../src/actions/propose/matching");
type CalendarEvent = import("../src/ingest/google").CalendarEvent;

const ZONE = "Europe/Berlin";

let n = 0;
function event(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: `e${++n}`, title: "Team sync", start: "2026-10-06T08:00:00.000Z", end: "2026-10-06T09:00:00.000Z", location: null, description: null, attendees: [], is_all_day: false, ...over };
}
const allDay = (start: string, end: string, title = "Holiday") => event({ title, start, end, is_all_day: true });

beforeEach(() => {
  resetGoogleState();
  mock.module("googleapis", () => googleapisModule);
});

describe("wallClock and weekday", () => {
  test("reads an instant as the wall clock of the zone, across DST", () => {
    expect(m.wallClock("2026-01-15T13:00:00Z", ZONE)).toBe("2026-01-15T14:00");
    expect(m.wallClock("2026-07-15T12:00:00Z", ZONE)).toBe("2026-07-15T14:00");
    expect(m.wallClock("2026-03-29T00:30:00Z", ZONE)).toBe("2026-03-29T01:30");
    expect(m.wallClock("2026-03-29T01:30:00Z", ZONE)).toBe("2026-03-29T03:30");
  });

  test("names the weekday of a date", () => {
    expect(m.weekday("2026-10-05")).toBe("Monday");
    expect(m.weekday("2026-10-11")).toBe("Sunday");
  });
});

describe("similar", () => {
  test("matches titles that share most of their words, case and accents aside", () => {
    expect(m.similar("Dentist appointment Tuesday", "dentist appointment")).toBe(true);
    expect(m.similar("Café Müller", "cafe muller")).toBe(true);
    expect(m.similar("Pay the electricity bill", "Pay electricity bill")).toBe(true);
  });

  test("the threshold is 60 percent of the shorter title's words", () => {
    // 5 words vs 3 words, 2 in common: 2/3 of the shorter one.
    expect(m.similar("alpha beta gamma delta epsilon", "alpha beta zeta")).toBe(true);
    // 5 words vs 5 words, 3 in common: exactly 0.6 counts.
    expect(m.similar("alpha beta gamma delta epsilon", "alpha beta gamma zeta theta")).toBe(true);
    // 5 words vs 5 words, 2 in common: 0.4 does not, nor does 2 of 4 (0.5) or 4 of 7 (0.57).
    expect(m.similar("alpha beta gamma delta epsilon", "alpha beta zeta theta kappa")).toBe(false);
    expect(m.similar("alpha beta gamma delta", "alpha beta zeta theta")).toBe(false);
    expect(m.similar("alpha beta gamma delta eps zeta eta", "alpha beta gamma delta iota kappa lambda")).toBe(false);
  });

  test("unrelated titles, and titles with nothing to compare, are not similar", () => {
    expect(m.similar("Dentist appointment", "Quarterly tax filing")).toBe(false);
    expect(m.similar("Go to it", "Go to it")).toBe(false);
    expect(m.similar("", "Dentist")).toBe(false);
    expect(m.similar("!!! ???", "Dentist")).toBe(false);
  });
});

describe("sameThing", () => {
  const todo = (title: string, task_id = "") => ({ kind: "add_todo" as const, parameters: { task_id }, preview: { kind: "add_todo" as const, title, due: null, notes: null } });

  test("proposals of different kinds are never the same thing", () => {
    const complete = { kind: "complete_todo" as const, parameters: { task_id: "t1" }, preview: { kind: "complete_todo" as const, title: "Call the bank", list: "L" } };
    expect(m.sameThing(todo("Call the bank"), complete)).toBe(false);
  });

  test("a complete_todo is the same task by id, whatever the title says", () => {
    const complete = (id: string, title: string) => ({ kind: "complete_todo" as const, parameters: { task_id: id }, preview: { kind: "complete_todo" as const, title, list: "L" } });
    expect(m.sameThing(complete("t1", "Call the bank"), complete("t1", "Something else"))).toBe(true);
    expect(m.sameThing(complete("t1", "Call the bank"), complete("t2", "Call the bank"))).toBe(false);
  });

  test("an update_event is the same event by id", () => {
    const update = (id: string, title: string) => ({
      kind: "update_event" as const,
      parameters: { event_id: id },
      preview: { kind: "update_event" as const, title, start: "", end: "", allDay: false, location: null, was: { start: "", end: "", allDay: false, location: null } },
    });
    expect(m.sameThing(update("ev1", "Standup"), update("ev1", "Retro"))).toBe(true);
    expect(m.sameThing(update("ev1", "Standup"), update("ev2", "Standup"))).toBe(false);
  });

  test("add_todo and add_event compare by similar title", () => {
    expect(m.sameThing(todo("Renew the passport"), todo("Renew passport"))).toBe(true);
    expect(m.sameThing(todo("Renew the passport"), todo("Buy groceries"))).toBe(false);
  });
});

describe("parseWhen", () => {
  test("a date is a whole-day event, with the end defaulting to the start", () => {
    expect(m.parseWhen("2026-10-06", "", ZONE)).toEqual({ allDay: true, start: "2026-10-06", end: "2026-10-06" });
    expect(m.parseWhen("2026-10-06", "2026-10-08", ZONE)).toEqual({ allDay: true, start: "2026-10-06", end: "2026-10-08" });
  });

  test("an all-day end before the start, or one that is not a date, falls back to the start", () => {
    expect(m.parseWhen("2026-10-06", "2026-10-04", ZONE)?.end).toBe("2026-10-06");
    expect(m.parseWhen("2026-10-06", "next week", ZONE)?.end).toBe("2026-10-06");
  });

  test("a wall-clock time is read in the zone, in winter and in summer", () => {
    expect(m.parseWhen("2026-01-15T14:00", "2026-01-15T15:30", ZONE)).toEqual({ allDay: false, start: "2026-01-15T13:00:00.000Z", end: "2026-01-15T14:30:00.000Z" });
    expect(m.parseWhen("2026-07-15T14:00", "2026-07-15T15:30", ZONE)).toEqual({ allDay: false, start: "2026-07-15T12:00:00.000Z", end: "2026-07-15T13:30:00.000Z" });
  });

  test("a missing end, or one not after the start, defaults to one hour", () => {
    expect(m.parseWhen("2026-01-15T14:00", "", ZONE)?.end).toBe("2026-01-15T14:00:00.000Z");
    expect(m.parseWhen("2026-01-15T14:00", "2026-01-15T14:00", ZONE)?.end).toBe("2026-01-15T14:00:00.000Z");
    expect(m.parseWhen("2026-01-15T14:00", "2026-01-15T13:00", ZONE)?.end).toBe("2026-01-15T14:00:00.000Z");
    expect(m.parseWhen("2026-01-15T14:00", "garbage", ZONE)?.end).toBe("2026-01-15T14:00:00.000Z");
  });

  test("times across the spring-forward switch land on the right instants", () => {
    expect(m.parseWhen("2026-03-29T01:30", "2026-03-29T03:30", ZONE)).toEqual({ allDay: false, start: "2026-03-29T00:30:00.000Z", end: "2026-03-29T01:30:00.000Z" });
  });

  test("a value that carries its own offset is taken as it stands", () => {
    expect(m.parseWhen("2026-01-15T14:00:00+02:00", "", ZONE)?.start).toBe("2026-01-15T12:00:00.000Z");
  });

  test("something that is no time at all is null", () => {
    expect(m.parseWhen("tomorrow at 3", "", ZONE)).toBeNull();
    expect(m.parseWhen("", "", ZONE)).toBeNull();
    expect(m.parseWhen("2026-13-45", "", ZONE)).toBeNull();
    expect(m.parseWhen("2026-02-31", "", ZONE)).toBeNull();
    expect(m.parseWhen("2026-02-30T10:00", "", ZONE)).toBeNull();
  });
});

describe("eventDays", () => {
  test("a whole-day event's end is exclusive, so the last day is the day before", () => {
    expect(m.eventDays(allDay("2026-10-06", "2026-10-09"), ZONE)).toEqual(["2026-10-06", "2026-10-08"]);
    expect(m.eventDays(allDay("2026-10-06", "2026-10-07"), ZONE)).toEqual(["2026-10-06", "2026-10-06"]);
  });

  test("a whole-day event with no end, or an end not after the start, covers its start day", () => {
    expect(m.eventDays(allDay("2026-10-06", ""), ZONE)).toEqual(["2026-10-06", "2026-10-06"]);
    expect(m.eventDays(allDay("2026-10-06", "2026-10-06"), ZONE)).toEqual(["2026-10-06", "2026-10-06"]);
  });

  test("a timed event's days are local days, which the same UTC time changes with DST", () => {
    // 22:30Z is 23:30 local in winter (still the 28th) and 00:30 local in summer (already the 1st).
    const winter = event({ start: "2026-01-28T22:30:00Z", end: "2026-01-28T22:45:00Z" });
    const summer = event({ start: "2026-06-30T22:30:00Z", end: "2026-06-30T22:45:00Z" });
    expect(m.eventDays(winter, ZONE)).toEqual(["2026-01-28", "2026-01-28"]);
    expect(m.eventDays(summer, ZONE)).toEqual(["2026-07-01", "2026-07-01"]);
  });

  test("a timed event that crosses local midnight spans two days, and one with no end spans its start", () => {
    expect(m.eventDays(event({ start: "2026-10-06T21:00:00Z", end: "2026-10-06T23:30:00Z" }), ZONE)).toEqual(["2026-10-06", "2026-10-07"]);
    expect(m.eventDays(event({ start: "2026-10-06T08:00:00Z", end: "" }), ZONE)).toEqual(["2026-10-06", "2026-10-06"]);
  });
});

describe("whenOf, skillTimes, firstDay", () => {
  test("whenOf keeps a whole-day end inclusive and normalizes timed instants", () => {
    expect(m.whenOf(allDay("2026-10-06", "2026-10-09"), ZONE)).toEqual({ allDay: true, start: "2026-10-06", end: "2026-10-08" });
    expect(m.whenOf(event({ start: "2026-10-06T10:00:00+02:00", end: "2026-10-06T11:00:00+02:00" }), ZONE)).toEqual({ allDay: false, start: "2026-10-06T08:00:00.000Z", end: "2026-10-06T09:00:00.000Z" });
  });

  test("skillTimes hands the calendar skills the exclusive next day for a whole-day event only", () => {
    expect(m.skillTimes({ allDay: true, start: "2026-10-06", end: "2026-10-08" })).toEqual({ start: "2026-10-06", end: "2026-10-09" });
    expect(m.skillTimes({ allDay: true, start: "2026-10-31", end: "2026-10-31" })).toEqual({ start: "2026-10-31", end: "2026-11-01" });
    expect(m.skillTimes({ allDay: false, start: "2026-10-06T08:00:00.000Z", end: "2026-10-06T09:00:00.000Z" })).toEqual({ start: "2026-10-06T08:00:00.000Z", end: "2026-10-06T09:00:00.000Z" });
  });

  test("firstDay is the local day of a timed start", () => {
    expect(m.firstDay({ allDay: true, start: "2026-10-06", end: "2026-10-06" }, ZONE)).toBe("2026-10-06");
    expect(m.firstDay({ allDay: false, start: "2026-10-06T22:30:00.000Z", end: "2026-10-06T23:00:00.000Z" }, ZONE)).toBe("2026-10-07");
  });
});

describe("isPast", () => {
  const now = new Date("2026-10-06T12:00:00Z");

  test("a timed event is past once its end is at or before now", () => {
    expect(m.isPast({ allDay: false, start: "2026-10-06T10:00:00.000Z", end: "2026-10-06T11:59:59.000Z" }, now, ZONE)).toBe(true);
    expect(m.isPast({ allDay: false, start: "2026-10-06T11:00:00.000Z", end: "2026-10-06T12:00:00.000Z" }, now, ZONE)).toBe(true);
    expect(m.isPast({ allDay: false, start: "2026-10-06T11:00:00.000Z", end: "2026-10-06T12:00:01.000Z" }, now, ZONE)).toBe(false);
  });

  test("a whole-day event is past only after its last day, by the zone's calendar", () => {
    expect(m.isPast({ allDay: true, start: "2026-10-05", end: "2026-10-05" }, now, ZONE)).toBe(true);
    expect(m.isPast({ allDay: true, start: "2026-10-06", end: "2026-10-06" }, now, ZONE)).toBe(false);
    expect(m.isPast({ allDay: true, start: "2026-10-06", end: "2026-10-08" }, now, ZONE)).toBe(false);
  });

  test("the zone decides which day it is: 23:30Z is already tomorrow in Berlin", () => {
    const lateEvening = new Date("2026-10-06T23:30:00Z");
    expect(m.isPast({ allDay: true, start: "2026-10-06", end: "2026-10-06" }, lateEvening, ZONE)).toBe(true);
    expect(m.isPast({ allDay: true, start: "2026-10-06", end: "2026-10-06" }, lateEvening, "UTC")).toBe(false);
  });

  test("a day-long event on the autumn switch day is not past at its local noon", () => {
    expect(m.isPast({ allDay: true, start: "2026-10-25", end: "2026-10-25" }, new Date("2026-10-25T11:00:00Z"), ZONE)).toBe(false);
    expect(m.isPast({ allDay: true, start: "2026-10-25", end: "2026-10-25" }, new Date("2026-10-25T23:00:00Z"), ZONE)).toBe(true);
  });
});

describe("inCalendar", () => {
  const when = { allDay: false, start: "2026-10-06T14:00:00.000Z", end: "2026-10-06T15:00:00.000Z" };

  test("a similar title on the same local day is a duplicate, however far apart in time", () => {
    const events = [event({ title: "Dentist appointment", start: "2026-10-06T07:00:00Z", end: "2026-10-06T08:00:00Z" })];
    expect(m.inCalendar("Dentist appointment", when, events, ZONE)).toBe(true);
  });

  test("a different title is a duplicate only within half an hour of the start", () => {
    const near = (minutes: number) => [event({ title: "Completely other", start: new Date(Date.parse(when.start) + minutes * 60_000).toISOString(), end: "2026-10-06T20:00:00Z" })];
    expect(m.inCalendar("Dentist", when, near(30), ZONE)).toBe(true);
    expect(m.inCalendar("Dentist", when, near(-30), ZONE)).toBe(true);
    expect(m.inCalendar("Dentist", when, near(31), ZONE)).toBe(false);
    expect(m.inCalendar("Dentist", when, near(-45), ZONE)).toBe(false);
  });

  test("an event on another day never matches, even with the same title", () => {
    expect(m.inCalendar("Team sync", when, [event({ start: "2026-10-07T08:00:00Z", end: "2026-10-07T09:00:00Z" })], ZONE)).toBe(false);
  });

  test("a multi-day whole-day event covers every day it spans, and its exclusive end day is free", () => {
    const trip = [allDay("2026-10-06", "2026-10-09", "Conference trip")];
    const on = (day: string) => m.inCalendar("Conference trip", { allDay: true, start: day, end: day }, trip, ZONE);
    expect(on("2026-10-06")).toBe(true);
    expect(on("2026-10-08")).toBe(true);
    expect(on("2026-10-09")).toBe(false);
  });

  test("the half-hour rule needs two timed events: a whole-day event or a whole-day proposal never trips it", () => {
    expect(m.inCalendar("Dentist", when, [allDay("2026-10-06", "2026-10-07", "Birthday")], ZONE)).toBe(false);
    const timed = [event({ title: "Other thing", start: when.start, end: when.end })];
    expect(m.inCalendar("Dentist", { allDay: true, start: "2026-10-06", end: "2026-10-06" }, timed, ZONE)).toBe(false);
  });

  test("an empty calendar has no duplicates", () => {
    expect(m.inCalendar("Dentist", when, [], ZONE)).toBe(false);
  });
});

describe("eventsOn", () => {
  const item = (id: string, summary: string, start: string, end: string) => ({ id, summary, start: { dateTime: start }, end: { dateTime: end } });

  test("asks the API for the local day, one 23-hour window on the spring-forward day", async () => {
    googleState.events = [item("a", "Standup", "2026-03-29T08:00:00Z", "2026-03-29T08:30:00Z")];
    const events = await m.eventsOn("2026-03-29", [], new Map(), ZONE);
    expect(events.map((e) => [e.id, e.title])).toEqual([["a", "Standup"]]);
    expect(googleState.listCalls[0]).toMatchObject({ timeMin: "2026-03-28T23:00:00.000Z", timeMax: "2026-03-29T22:00:00.000Z" });
  });

  test("answers a repeated day from the cache, with one API call", async () => {
    const cache = new Map();
    const first = await m.eventsOn("2026-10-06", [], cache, ZONE);
    const second = await m.eventsOn("2026-10-06", [], cache, ZONE);
    expect(second).toBe(first);
    await m.eventsOn("2026-10-07", [], cache, ZONE);
    expect(googleState.listCalls).toHaveLength(2);
  });

  test("when the API fails it falls back to the ingested events that touch that day", async () => {
    googleState.eventsError = new Error("quota");
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const ingested = [
        event({ id: "mine", start: "2026-10-06T08:00:00Z", end: "2026-10-06T09:00:00Z" }),
        event({ id: "other", start: "2026-10-07T08:00:00Z", end: "2026-10-07T09:00:00Z" }),
        allDay("2026-10-05", "2026-10-08", "Trip"),
      ];
      const events = await m.eventsOn("2026-10-06", ingested, new Map(), ZONE);
      expect(events.map((e) => e.title).sort()).toEqual(["Team sync", "Trip"]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = original;
    }
  });
});
