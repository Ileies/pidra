import type { Skill } from "../src/skills/loader";
import { getCalendarClient } from "../src/ingest/google";
import { boolParam, intParam } from "../src/skills/params";

const skill: Skill = {
  name: "get_calendar_event",
  description:
    "Get every detail of one Google Calendar event: times, location, description, attendees and their replies, organizer, recurrence, video link, reminders. Find the id with list_calendar_events first",
  risk_level: "low",
  touches: [],
  parameters: {
    event_id: { type: "string", required: true, description: "Google Calendar event ID" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
    include_attendees: { type: "boolean", required: false, description: "List the attendees and their replies. Default: true" },
    max_description_chars: { type: "number", required: false, description: "Cut a long description after this many characters, 100 to 20000. Default: 4000" },
  },
  execute: async (params) => {
    const calendar = getCalendarClient();
    const calendarId = String(params.calendar_id ?? "primary");
    const eventId = String(params.event_id ?? "").trim();
    if (!eventId) throw new Error("event_id is required");

    const includeAttendees = boolParam(params.include_attendees, true);
    const maxDescription = intParam(params.max_description_chars, "max_description_chars", 4000, 100, 20000);

    const { data: e } = await calendar.events.get({ calendarId, eventId });
    const description = e.description && e.description.length > maxDescription
      ? `${e.description.slice(0, maxDescription)}... (cut, ${e.description.length} characters in all)`
      : e.description;

    const allDay = !e.start?.dateTime;
    const lines: (string | null)[] = [
      `Title: ${e.summary ?? "(no title)"}`,
      `Start: ${e.start?.dateTime ?? e.start?.date ?? "?"}${allDay ? " (all day)" : ""}`,
      `End: ${e.end?.dateTime ?? e.end?.date ?? "?"}`,
      e.start?.timeZone ? `Time zone: ${e.start.timeZone}` : null,
      `Status: ${e.status ?? "confirmed"}`,
      e.location ? `Location: ${e.location}` : null,
      description ? `Description: ${description}` : null,
      e.organizer?.email ? `Organizer: ${e.organizer.displayName ? `${e.organizer.displayName} ` : ""}<${e.organizer.email}>` : null,
      includeAttendees && e.attendees?.length
        ?`Attendees:\n${e.attendees.map((a) => `  - ${a.displayName ? `${a.displayName} ` : ""}<${a.email}> (${a.responseStatus ?? "needsAction"}${a.optional ? ", optional" : ""})`).join("\n")}`
        : null,
      e.recurrence?.length ? `Recurrence: ${e.recurrence.join("; ")}` : null,
      e.recurringEventId ? `Instance of recurring event: ${e.recurringEventId}` : null,
      e.hangoutLink ? `Video link: ${e.hangoutLink}` : null,
      e.reminders?.overrides?.length
        ? `Reminders: ${e.reminders.overrides.map((r) => `${r.minutes} min ${r.method}`).join(", ")}`
        : e.reminders?.useDefault
          ? "Reminders: calendar defaults"
          : null,
      e.htmlLink ? `Link: ${e.htmlLink}` : null,
      e.updated ? `Last changed: ${e.updated}` : null,
      `id=${e.id}`,
    ];
    return lines.filter((l): l is string => l !== null).join("\n");
  },
};

export default skill;
