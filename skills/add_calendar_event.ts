import type { Skill } from "../src/skills/loader";
import { getCalendarClient } from "../src/ingest/google";
import { boolParam, emailList, eventTime, intParam, reminderOverrides, sendUpdatesParam } from "../src/skills/params";
import { addDays, isLocalDate } from "../src/util/time";

const VISIBILITIES = ["default", "public", "private", "confidential"];

const skill: Skill = {
  name: "add_calendar_event",
  description:
    "Create an event in Google Calendar. Only title and start are needed: without an end it lasts duration_minutes (default 60), or one day if start is a date. Check list_calendar_events first when a clash matters",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true, description: "Event title" },
    start: {
      type: "string",
      required: true,
      description: "Start: ISO 8601 datetime (a time without an offset is read in the user's own time zone), or YYYY-MM-DD for a whole-day event",
    },
    end: {
      type: "string",
      required: false,
      description: "End, in the same form as start. For a whole-day event, the day after the last day. Default: start plus duration_minutes, or the next day for a whole-day event",
    },
    duration_minutes: { type: "number", required: false, description: "Length in minutes when end is not given, 1 to 10080. Default: 60" },
    description: { type: "string", required: false, description: "Event description" },
    location: { type: "string", required: false, description: "Event location" },
    attendees: { type: "string", required: false, description: "Guests to invite: email addresses separated by commas. Default: none" },
    send_updates: { type: "string", required: false, description: "Whether Google emails the guests: all, externalOnly or none. Default: none" },
    reminders_minutes: {
      type: "string",
      required: false,
      description: 'Popup reminders, minutes before the start, comma separated (e.g. "10,60"), "none" for no reminder or "default" for the calendar defaults. Default: the calendar defaults',
    },
    recurrence: {
      type: "string",
      required: false,
      description: 'Repeat rule in RFC 5545 form, e.g. "RRULE:FREQ=WEEKLY;COUNT=10" or "RRULE:FREQ=DAILY;UNTIL=20261231". Default: a single event',
    },
    video_call: { type: "boolean", required: false, description: "Attach a Google Meet link. Default: false" },
    busy: { type: "boolean", required: false, description: "Show as busy (true) or free (false) in availability. Default: true" },
    visibility: { type: "string", required: false, description: `One of ${VISIBILITIES.join(", ")}. Default: default` },
    color_id: { type: "number", required: false, description: "Calendar color 1 to 11. Default: the calendar's own colour" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params, ctx) => {
    const calendar = getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("title is required");
    if (!params.start) throw new Error("start is required");

    const startText = String(params.start).trim();
    const start = eventTime(startText, ctx.timeZone);
    let end;
    if (params.end) {
      end = eventTime(String(params.end), ctx.timeZone);
    } else if (isLocalDate(startText)) {
      end = eventTime(addDays(startText, 1), ctx.timeZone);
    } else {
      const minutes = intParam(params.duration_minutes, "duration_minutes", 60, 1, 10080);
      end = eventTime(new Date(Date.parse(start.dateTime as string) + minutes * 60_000).toISOString(), ctx.timeZone);
    }

    const visibility = String(params.visibility ?? "default").trim();
    if (!VISIBILITIES.includes(visibility)) throw new Error(`visibility must be one of: ${VISIBILITIES.join(", ")}`);
    const attendees = emailList(params.attendees, "attendees");
    const colorId = params.color_id === undefined || params.color_id === "" ? undefined : intParam(params.color_id, "color_id", 1, 1, 11);
    const videoCall = boolParam(params.video_call);

    const event = {
      summary: title,
      description: params.description ? String(params.description) : undefined,
      location: params.location ? String(params.location) : undefined,
      start,
      end,
      attendees: attendees.length ? attendees.map((email) => ({ email })) : undefined,
      reminders: reminderOverrides(params.reminders_minutes),
      recurrence: params.recurrence ? [String(params.recurrence).trim()] : undefined,
      transparency: boolParam(params.busy, true) ? "opaque" : "transparent",
      visibility: visibility === "default" ? undefined : visibility,
      colorId: colorId ? String(colorId) : undefined,
      conferenceData: videoCall
        ? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
        : undefined,
    };

    const res = await calendar.events.insert({
      calendarId,
      requestBody: event,
      sendUpdates: sendUpdatesParam(params.send_updates),
      conferenceDataVersion: videoCall ? 1 : undefined,
    });
    const extras = [
      attendees.length ? `${attendees.length} guest(s)` : null,
      res.data.hangoutLink ? `Meet: ${res.data.hangoutLink}` : null,
      params.recurrence ? "recurring" : null,
    ].filter(Boolean);
    return `Event created: "${res.data.summary}" on ${res.data.start?.dateTime ?? res.data.start?.date} to ${res.data.end?.dateTime ?? res.data.end?.date}${extras.length ? ` (${extras.join(", ")})` : ""} (id=${res.data.id})`;
  },
};

export default skill;
