import type { calendar_v3 } from "googleapis";
import type { Skill } from "../src/skills/loader";
import { getCalendarClient } from "../src/ingest/google";
import { boolParam, emailList, eventTime, intParam, reminderOverrides, sendUpdatesParam } from "../src/skills/params";
import { addDays, isLocalDate, DAY_MS } from "../src/util/time";

const VISIBILITIES = ["default", "public", "private", "confidential"];

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Where a moved event ends when the caller gave a new start but no end: the same length as before,
 * so "move it to 15:00" keeps its duration instead of demanding the end be restated.
 */
function endForNewStart(
  newStart: string,
  existing: calendar_v3.Schema$Event,
  minutes: number | null,
  timeZone: string,
): calendar_v3.Schema$EventDateTime {
  if (isLocalDate(newStart)) {
    const span = existing.start?.date && existing.end?.date ? Math.max(1, daysBetween(existing.start.date, existing.end.date)) : 1;
    return eventTime(addDays(newStart, span), timeZone);
  }
  const startMs = Date.parse(eventTime(newStart, timeZone).dateTime as string);
  const oldStart = existing.start?.dateTime ? Date.parse(existing.start.dateTime) : NaN;
  const oldEnd = existing.end?.dateTime ? Date.parse(existing.end.dateTime) : NaN;
  const length = minutes ?? (Number.isNaN(oldStart) || Number.isNaN(oldEnd) ? 60 : Math.round((oldEnd - oldStart) / 60_000));
  return eventTime(new Date(startMs + length * 60_000).toISOString(), timeZone);
}

/**
 * Medium, not low like adding: it changes an entry the owner made, and a low skill is one the
 * pipeline may run on its own from a SYSTEM-block suggestion (`processSkillSuggestions`). A quick
 * action or the chat can still run it; both are the owner asking.
 */
const skill: Skill = {
  name: "update_calendar_event",
  description:
    "Change an existing Google Calendar event: move it, rename it, relocate it, re-describe it, or change guests and reminders. Only the fields given change. Giving just a new start keeps the event's length. Find the id with list_calendar_events first",
  risk_level: "medium",
  parameters: {
    event_id: { type: "string", required: true, description: "Google Calendar event ID" },
    start: {
      type: "string",
      required: false,
      description: "New start: ISO 8601 datetime (a time without an offset is read in the user's own time zone), or YYYY-MM-DD for a whole-day event. Without end the event keeps its length",
    },
    end: { type: "string", required: false, description: "New end, in the same form as start. Without start the event keeps its start" },
    duration_minutes: { type: "number", required: false, description: "With a new start and no end: the new length in minutes, 1 to 10080. Default: the current length" },
    title: { type: "string", required: false, description: "New title" },
    description: { type: "string", required: false, description: "New description (replaces the old one; an empty string clears it)" },
    location: { type: "string", required: false, description: "New location (an empty string clears it)" },
    add_attendees: { type: "string", required: false, description: "Guests to add: email addresses separated by commas" },
    remove_attendees: { type: "string", required: false, description: "Guests to remove: email addresses separated by commas" },
    send_updates: { type: "string", required: false, description: "Whether Google emails the guests about the change: all, externalOnly or none. Default: none" },
    reminders_minutes: {
      type: "string",
      required: false,
      description: 'Replace the popup reminders: minutes before the start, comma separated (e.g. "10,60"), "none" or "default"',
    },
    busy: { type: "boolean", required: false, description: "Show as busy (true) or free (false) in availability" },
    visibility: { type: "string", required: false, description: `One of ${VISIBILITIES.join(", ")}` },
    color_id: { type: "number", required: false, description: "Calendar color 1 to 11" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params, ctx) => {
    const calendar = getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const eventId = String(params.event_id ?? "").trim();
    if (!eventId) throw new Error("event_id is required");

    const addGuests = emailList(params.add_attendees, "add_attendees");
    const removeGuests = emailList(params.remove_attendees, "remove_attendees");
    const moves = !!(params.start || params.end);
    const needsExisting = moves || addGuests.length > 0 || removeGuests.length > 0;
    const existing = needsExisting ? (await calendar.events.get({ calendarId, eventId })).data : null;

    const patch: Record<string, unknown> = {};

    if (existing && moves) {
      const minutes = params.duration_minutes === undefined || params.duration_minutes === "" ? null : intParam(params.duration_minutes, "duration_minutes", 60, 1, 10080);
      if (params.start) {
        patch.start = eventTime(String(params.start), ctx.timeZone);
        patch.end = params.end ? eventTime(String(params.end), ctx.timeZone) : endForNewStart(String(params.start), existing, minutes, ctx.timeZone);
      } else {
        patch.end = eventTime(String(params.end), ctx.timeZone);
      }
    }
    if (params.title) patch.summary = String(params.title).trim();
    if (params.description != null) patch.description = String(params.description);
    if (params.location != null) patch.location = String(params.location);

    if (existing && (addGuests.length > 0 || removeGuests.length > 0)) {
      const current = existing.attendees ?? [];
      const kept = current.filter((a) => !removeGuests.includes((a.email ?? "").toLowerCase()));
      const have = new Set(kept.map((a) => (a.email ?? "").toLowerCase()));
      patch.attendees = [...kept, ...addGuests.filter((email) => !have.has(email)).map((email) => ({ email }))];
    }

    const reminders = reminderOverrides(params.reminders_minutes);
    if (reminders) patch.reminders = reminders;
    if (params.busy !== undefined && params.busy !== "") patch.transparency = boolParam(params.busy) ? "opaque" : "transparent";
    if (params.visibility) {
      const visibility = String(params.visibility).trim();
      if (!VISIBILITIES.includes(visibility)) throw new Error(`visibility must be one of: ${VISIBILITIES.join(", ")}`);
      patch.visibility = visibility;
    }
    if (params.color_id !== undefined && params.color_id !== "") patch.colorId = String(intParam(params.color_id, "color_id", 1, 1, 11));

    if (Object.keys(patch).length === 0) {
      throw new Error("nothing to change: give start or end, title, description, location, guests, reminders, busy, visibility or color_id");
    }

    const res = await calendar.events.patch({ calendarId, eventId, requestBody: patch, sendUpdates: sendUpdatesParam(params.send_updates) });
    return `Event updated (${Object.keys(patch).join(", ")}): "${res.data.summary}" on ${res.data.start?.dateTime ?? res.data.start?.date} to ${res.data.end?.dateTime ?? res.data.end?.date} (id=${res.data.id})`;
  },
};

export default skill;
