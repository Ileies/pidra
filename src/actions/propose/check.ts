import { squash } from "../../util/text";
import type { CalendarEvent, TodoItem } from "../../ingest/google";
import { isLocalDate } from "../../util/time";
import type { Mail } from "./mails";
import { eventsOn, firstDay, inCalendar, isPast, parseWhen, similar, skillTimes, whenOf } from "./matching";
import type { ActionPreview, DiscardReason, ModelAction } from "./types";

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

/**
 * One line, capped, and without links. A link copied from a mail into the owner's own calendar
 * or to-do list reads as one they put there themselves, which is exactly the trust a phishing
 * link is after; the prompt says so too, and this holds when it is not obeyed.
 */
export const clean = (text: string, max: number) => squash(text.replace(LINK, "(link in the mail)"), max);

export interface Refs {
  mails: Map<string, Mail>;
  events: Map<string, CalendarEvent>;
  tasks: Map<string, TodoItem>;
  ingestedCalendar: CalendarEvent[];
  openTasks: TodoItem[];
  calendarByDay: Map<string, Promise<CalendarEvent[]>>;
  now: Date;
  /** The zone the model's wall-clock times are in. */
  zone: string;
}

export type Checked =
  | { ok: true; parameters: Record<string, unknown>; preview: ActionPreview }
  | { ok: false; reason: DiscardReason; preview: ActionPreview };

/** What the model said, shaped as a preview, for a discarded row nobody will ever render. */
export function rawPreview(action: ModelAction): ActionPreview {
  switch (action.kind) {
    case "add_todo":
      return { kind: "add_todo", title: action.title, due: action.due || null, notes: action.notes || null };
    case "complete_todo":
      return { kind: "complete_todo", title: action.task_id, list: "" };
    default:
      return { kind: "add_event", title: action.title || action.event_id, start: action.start, end: action.end, allDay: isLocalDate(action.start), location: action.location || null };
  }
}

/** Validates one model action against the calendar and task list and turns it into skill parameters. */
export async function check(action: ModelAction, refs: Refs): Promise<Checked> {
  const discard = (reason: DiscardReason): Checked => ({ ok: false, reason, preview: rawPreview(action) });
  const title = clean(action.title, 120);
  const location = clean(action.location, 200) || null;
  const notes = clean(action.notes, 300) || null;

  switch (action.kind) {
    case "add_event": {
      if (!title) return discard("empty_title");
      const when = parseWhen(action.start, action.end, refs.zone);
      if (!when) return discard("bad_time");
      if (isPast(when, refs.now, refs.zone)) return discard("in_past");
      const onDay = await eventsOn(firstDay(when, refs.zone), refs.ingestedCalendar, refs.calendarByDay, refs.zone);
      if (inCalendar(title, when, onDay, refs.zone)) return discard("already_in_calendar");
      return {
        ok: true,
        parameters: {
          title,
          ...skillTimes(when),
          ...(location ? { location } : {}),
          ...(notes ? { description: notes } : {}),
        },
        preview: { kind: "add_event", title, ...when, location },
      };
    }

    case "update_event": {
      const event = refs.events.get(action.event_id.trim());
      if (!event) return discard("unknown_event");
      const was = whenOf(event, refs.zone);
      let when = was;
      if (action.start.trim()) {
        const parsed = parseWhen(action.start, action.end, refs.zone);
        if (!parsed) return discard("bad_time");
        // A new start without an end keeps the event's length rather than the one-hour default.
        when = action.end.trim() || parsed.allDay !== was.allDay || was.allDay
          ? parsed
          : { ...parsed, end: new Date(Date.parse(parsed.start) + Date.parse(was.end) - Date.parse(was.start)).toISOString() };
      }
      if (isPast(when, refs.now, refs.zone)) return discard("in_past");

      const moved = when.start !== was.start || when.end !== was.end || when.allDay !== was.allDay;
      const relocated = location !== null && location !== (event.location ?? null);
      const renamed = title !== "" && title !== event.title;
      if (!moved && !relocated && !renamed) return discard("no_change");

      return {
        ok: true,
        parameters: {
          event_id: event.id,
          ...(moved ? skillTimes(when) : {}),
          ...(relocated ? { location } : {}),
          ...(renamed ? { title } : {}),
        },
        preview: {
          kind: "update_event",
          title: renamed ? title : event.title,
          ...when,
          location: relocated ? location : event.location,
          was: { ...was, location: event.location },
        },
      };
    }

    case "add_todo": {
      if (!title) return discard("empty_title");
      if (refs.openTasks.some((task) => similar(title, task.title))) return discard("already_on_list");
      const due = isLocalDate(action.due.trim()) ? action.due.trim() : null;
      return {
        ok: true,
        parameters: { title, ...(notes ? { notes } : {}), ...(due ? { due } : {}) },
        preview: { kind: "add_todo", title, due, notes },
      };
    }

    case "complete_todo": {
      const task = refs.tasks.get(action.task_id.trim());
      if (!task) return discard("unknown_task");
      return {
        ok: true,
        // By list name: that is what the ingest keeps, and `resolveTaskList` takes either.
        parameters: { task_id: task.id, list_id: task.list_name },
        preview: { kind: "complete_todo", title: task.title, list: task.list_name },
      };
    }
  }
}
