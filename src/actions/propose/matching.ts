import { errMessage } from "../../util/text";
import { listCalendarEvents, type CalendarEvent } from "../../ingest/google";
import { addDays, isLocalDate, localDay, zonedToIso } from "../../util/time";
import type { Proposal } from "./types";

// Time and similarity helpers for quick actions. Conventions: an all-day `When` holds dates with the
// LAST day inclusive in `end`; the calendar skills want the exclusive next day (see `skillTimes`).

/** An instant as the wall clock in `zone` reads it: "2026-09-30T14:00". */
export function wallClock(iso: string, zone: string): string {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: zone }).slice(0, 16).replace(" ", "T");
}

export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** The first and last local day an event covers. A whole-day event's `end` is exclusive. */
export function eventDays(event: CalendarEvent, zone: string): [string, string] {
  if (event.is_all_day) {
    const last = event.end ? addDays(event.end, -1) : event.start;
    return [event.start, last >= event.start ? last : event.start];
  }
  return [localDay(event.start, zone), localDay(event.end || event.start, zone)];
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
export function similar(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return false;
  let common = 0;
  for (const w of left) if (right.has(w)) common++;
  return common / Math.min(left.size, right.size) >= 0.6;
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

export interface When {
  allDay: boolean;
  /** Instant, or a date for a whole-day event. */
  start: string;
  /** Instant, or the last day inclusive. */
  end: string;
}

/** The model's local start and end as a `When`, defaulting a missing end to an hour or a day. */
export function parseWhen(start: string, end: string, zone: string): When | null {
  const s = start.trim();
  const e = end.trim();
  if (isLocalDate(s)) {
    return { allDay: true, start: s, end: isLocalDate(e) && e >= s ? e : s };
  }
  const startIso = zonedToIso(s, zone);
  if (!startIso) return null;
  const endIso = e ? zonedToIso(e, zone) : null;
  return {
    allDay: false,
    start: startIso,
    end: endIso && endIso > startIso ? endIso : new Date(Date.parse(startIso) + 3_600_000).toISOString(),
  };
}

export function whenOf(event: CalendarEvent, zone: string): When {
  if (event.is_all_day) {
    const [first, last] = eventDays(event, zone);
    return { allDay: true, start: first, end: last };
  }
  return { allDay: false, start: new Date(event.start).toISOString(), end: new Date(event.end || event.start).toISOString() };
}

/** What the calendar skills take: instants as they are, a whole-day end as the exclusive next day. */
export function skillTimes(when: When): { start: string; end: string } {
  return when.allDay ? { start: when.start, end: addDays(when.end, 1) } : { start: when.start, end: when.end };
}

export function isPast(when: When, now: Date, zone: string): boolean {
  return when.allDay ? when.end < localDay(now.toISOString(), zone) : when.end <= now.toISOString();
}

export function firstDay(when: When, zone: string): string {
  return when.allDay ? when.start : localDay(when.start, zone);
}

/** The calendar on one day, from the API; the ingested week if the API does not answer. */
export function eventsOn(day: string, ingested: CalendarEvent[], cache: Map<string, Promise<CalendarEvent[]>>, zone: string) {
  let pending = cache.get(day);
  if (!pending) {
    pending = listCalendarEvents(zonedToIso(`${day}T00:00`, zone)!, zonedToIso(`${addDays(day, 1)}T00:00`, zone)!).catch((err) => {
      console.warn(`[Actions] Calendar lookup for ${day} failed, checking the ingested week only: ${errMessage(err)}`);
      return ingested.filter((event) => {
        const [first, last] = eventDays(event, zone);
        return first <= day && day <= last;
      });
    });
    cache.set(day, pending);
  }
  return pending;
}

export function inCalendar(title: string, when: When, events: CalendarEvent[], zone: string): boolean {
  const day = firstDay(when, zone);
  return events.some((event) => {
    const [first, last] = eventDays(event, zone);
    if (day < first || day > last) return false;
    if (similar(title, event.title)) return true;
    // Two different things rarely start within half an hour of each other on the same day.
    return !when.allDay && !event.is_all_day && Math.abs(Date.parse(event.start) - Date.parse(when.start)) <= 30 * 60_000;
  });
}
