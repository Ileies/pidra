import type { Skill } from "../src/skills/loader";
import { eventTime, getCalendarClient } from "../src/ingest/google";

/**
 * Medium, not low like adding: it changes an entry the owner made, and a low skill is one the
 * pipeline may run on its own from a SYSTEM-block suggestion (`processSkillSuggestions`). A quick
 * action or the chat can still run it; both are the owner asking.
 */
const skill: Skill = {
  name: "update_calendar_event",
  description: "Move, rename or relocate an existing Google Calendar event. Only the fields given change",
  risk_level: "medium",
  parameters: {
    event_id: { type: "string", required: true, description: "Google Calendar event ID" },
    start: {
      type: "string",
      required: false,
      description: "New start: ISO 8601 datetime (a time without an offset is read as Europe/Berlin), or YYYY-MM-DD for a whole-day event. Requires end",
    },
    end: { type: "string", required: false, description: "New end, in the same form as start. Requires start" },
    location: { type: "string", required: false, description: "New location" },
    title: { type: "string", required: false, description: "New title" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params) => {
    const calendar = await getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const eventId = String(params.event_id ?? "").trim();
    if (!eventId) throw new Error("event_id is required");
    if (!params.start !== !params.end) throw new Error("start and end must be given together");

    const patch: Record<string, unknown> = {};
    if (params.start && params.end) {
      patch.start = eventTime(String(params.start));
      patch.end = eventTime(String(params.end));
    }
    if (params.location) patch.location = String(params.location);
    if (params.title) patch.summary = String(params.title).trim();
    if (Object.keys(patch).length === 0) throw new Error("nothing to change: give start and end, location or title");

    const res = await calendar.events.patch({ calendarId, eventId, requestBody: patch });
    return `Event updated: "${res.data.summary}" on ${res.data.start?.dateTime ?? res.data.start?.date} (id=${res.data.id})`;
  },
};

export default skill;
