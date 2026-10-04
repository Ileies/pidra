import type { Skill } from "../src/skills/loader";
import { listCalendarEvents } from "../src/ingest/google";
import { intParam } from "../src/skills/params";
import { addDays, isLocalDate, localDay, zonedToIso } from "../src/util/time";

const DEFAULT_DAYS = 14;

/** A `YYYY-MM-DD` day as the instant its midnight falls on in `timeZone`. */
function dayStart(day: string, timeZone: string): string {
  const iso = zonedToIso(`${day}T00:00`, timeZone);
  if (!iso) throw new Error(`Not a date: "${day}"`);
  return iso;
}

/** `today`, `tomorrow`, `yesterday` or `YYYY-MM-DD`, as a calendar day in the user's zone. */
function resolveDay(value: unknown, name: string, fallback: string, today: string): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (text === "today") return today;
  if (text === "tomorrow") return addDays(today, 1);
  if (text === "yesterday") return addDays(today, -1);
  if (!isLocalDate(text)) throw new Error(`${name} must be YYYY-MM-DD, "today", "tomorrow" or "yesterday" (got "${text}")`);
  return text;
}

const skill: Skill = {
  name: "list_calendar_events",
  description:
    "List Google Calendar events in a date range, one line each, with their ids. Defaults to today and the next 14 days. For every detail of one event use get_calendar_event; update_calendar_event and delete_calendar_event need the id from here",
  risk_level: "low",
  parameters: {
    from: { type: "string", required: false, description: 'First day: YYYY-MM-DD, "today", "tomorrow" or "yesterday". Default: today' },
    to: { type: "string", required: false, description: "Last day, inclusive, same forms as from. Default: from plus days minus one" },
    days: { type: "number", required: false, description: `How many days to cover when to is not given, 1 to 366. Default: ${DEFAULT_DAYS}` },
    query: { type: "string", required: false, description: "Only events matching this text in title, description, location or attendees" },
    limit: { type: "number", required: false, description: "Maximum number of events, 1 to 250. Default: 50" },
    calendar_id: { type: "string", required: false, description: "Calendar ID (default: primary)" },
  },
  execute: async (params, ctx) => {
    const zone = ctx.timeZone;
    const today = localDay(new Date().toISOString(), zone);
    const from = resolveDay(params.from, "from", today, today);
    const days = intParam(params.days, "days", DEFAULT_DAYS, 1, 366);
    const to = resolveDay(params.to, "to", addDays(from, days - 1), today);
    if (to < from) throw new Error("to must not be before from");
    const limit = intParam(params.limit, "limit", 50, 1, 250);
    const query = String(params.query ?? "").trim();

    const events = await listCalendarEvents(dayStart(from, zone), dayStart(addDays(to, 1), zone), {
      calendarId: params.calendar_id ? String(params.calendar_id) : undefined,
      query,
      limit,
    });
    if (events.length === 0) return `No events from ${from} to ${to}${query ? ` matching "${query}"` : ""}.`;

    const lines = events.map((e) => {
      const when = e.is_all_day ? `${e.start} (all day)` : `${e.start} to ${e.end}`;
      return `- ${e.title} | ${when}${e.location ? ` | ${e.location}` : ""} | id=${e.id}`;
    });
    const more = events.length >= limit ? `\n(showing the first ${limit}; narrow the range or raise limit for more)` : "";
    return `${lines.join("\n")}${more}\n(${from} to ${to}, days in ${zone}, times as shown with their offset)`;
  },
};

export default skill;
