import type { Skill } from "../src/skills/loader";
import { getCalendarClient } from "../src/ingest/google";

const skill: Skill = {
  name: "add_calendar_event",
  description: "Create an event in Google Calendar",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true, description: "Event title" },
    start: { type: "string", required: true, description: "Start datetime (ISO 8601)" },
    end: { type: "string", required: true, description: "End datetime (ISO 8601)" },
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

    const timeZone = "Europe/Berlin";
    const event = {
      summary: title,
      description: params.description ? String(params.description) : undefined,
      location: params.location ? String(params.location) : undefined,
      start: { dateTime: new Date(String(params.start)).toISOString(), timeZone },
      end: { dateTime: new Date(String(params.end)).toISOString(), timeZone },
    };

    const res = await calendar.events.insert({ calendarId, requestBody: event });
    return `Event created: "${res.data.summary}" on ${res.data.start?.dateTime} (id=${res.data.id})`;
  },
};

export default skill;
