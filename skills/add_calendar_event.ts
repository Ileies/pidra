import type { Skill } from "../src/skills/loader";
import { eventTime, getCalendarClient } from "../src/ingest/google";

const skill: Skill = {
  name: "add_calendar_event",
  description: "Create an event in Google Calendar",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true, description: "Event title" },
    start: {
      type: "string",
      required: true,
      description: "Start: ISO 8601 datetime (a time without an offset is read as Europe/Berlin), or YYYY-MM-DD for a whole-day event",
    },
    end: {
      type: "string",
      required: true,
      description: "End, in the same form as start. For a whole-day event, the day after the last day",
    },
    description: { type: "string", required: false, description: "Event description" },
    location: { type: "string", required: false, description: "Event location" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params) => {
    const calendar = await getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("title is required");
    if (!params.start || !params.end) throw new Error("start and end are required");

    const event = {
      summary: title,
      description: params.description ? String(params.description) : undefined,
      location: params.location ? String(params.location) : undefined,
      start: eventTime(String(params.start)),
      end: eventTime(String(params.end)),
    };

    const res = await calendar.events.insert({ calendarId, requestBody: event });
    return `Event created: "${res.data.summary}" on ${res.data.start?.dateTime ?? res.data.start?.date} (id=${res.data.id})`;
  },
};

export default skill;
