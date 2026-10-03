import type { Skill } from "../src/skills/loader";
import { assertExpectedTitle, getCalendarClient, sendUpdatesParam } from "../src/ingest/google";

/** Medium for the same reason as `update_calendar_event`: it removes an entry the owner made. */
const skill: Skill = {
  name: "delete_calendar_event",
  description:
    "Delete an existing Google Calendar event. Find its id with list_calendar_events first, and pass expected_title so a wrong id cannot delete the wrong event",
  risk_level: "medium",
  parameters: {
    event_id: { type: "string", required: true, description: "Google Calendar event ID" },
    expected_title: {
      type: "string",
      required: false,
      description: "Safety check: delete only if the event's title contains this text (case-insensitive). Default: no check",
    },
    send_updates: { type: "string", required: false, description: "Whether Google emails the guests about the cancellation: all, externalOnly or none. Default: none" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params) => {
    const calendar = await getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const eventId = String(params.event_id ?? "").trim();
    if (!eventId) throw new Error("event_id is required");

    const existing = await calendar.events.get({ calendarId, eventId });
    assertExpectedTitle(params.expected_title, existing.data.summary, "event");
    await calendar.events.delete({ calendarId, eventId, sendUpdates: sendUpdatesParam(params.send_updates) });
    return `Event deleted: "${existing.data.summary}" on ${existing.data.start?.dateTime ?? existing.data.start?.date} (id=${eventId})`;
  },
};

export default skill;
