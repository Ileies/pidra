import type { ContextPayload } from "../../pipeline/phase3-context";

export const ACTION_KINDS = ["add_event", "update_event", "add_todo", "complete_todo"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * The skill each kind runs, and the only skills a quick action can run: a row's `skill_name` is
 * always one of these, which is why a tap needs no surface check of its own (`store.ts`).
 */
export const SKILL_FOR: Record<ActionKind, string> = {
  add_event: "add_calendar_event",
  update_event: "update_calendar_event",
  add_todo: "add_todo_item",
  complete_todo: "complete_todo_item",
};

interface EventPreview {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
}

/**
 * What the button shows, so the reader knows exactly what a tap will write before making it.
 * Timed values are UTC instants and the dashboard formats them; a whole-day `end` is the last
 * day, inclusive, whatever the Calendar API wants.
 */
export type ActionPreview =
  | ({ kind: "add_event" } & EventPreview)
  | ({ kind: "update_event"; was: Omit<EventPreview, "title"> } & EventPreview)
  | { kind: "add_todo"; title: string; due: string | null; notes: string | null }
  | { kind: "complete_todo"; title: string; list: string };

export type DiscardReason =
  | "unknown_mail"
  | "empty_title"
  | "bad_time"
  | "in_past"
  | "already_in_calendar"
  | "unknown_event"
  | "no_change"
  | "already_on_list"
  | "unknown_task"
  | "duplicate"
  | "per_mail_cap"
  | "daily_cap"
  /** A re-run proposed what the reader already did or dismissed for this date (`store.ts`). */
  | "already_handled";

export interface Proposal {
  kind: ActionKind;
  skillName: string;
  parameters: Record<string, unknown>;
  preview: ActionPreview;
  reason: string;
  sourceExtractionIds: string[];
  /** Null when the action is offered; otherwise why code threw it out. */
  discarded: DiscardReason | null;
}

export interface QuickActionsResult {
  proposals: Proposal[];
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
}

/**
 * What the agent reads from Phase 3. Narrow on purpose, so `scripts/actions-dry-run.ts` can build
 * it without running Phase 3, which writes gate verdicts and spends web searches.
 */
export type ActionInputs = Pick<ContextPayload, "calendarItems" | "notesPersonal" | "longTermContext">;

export interface ModelAction {
  kind: ActionKind;
  mail_ids: string[];
  why: string;
  title: string;
  start: string;
  end: string;
  location: string;
  notes: string;
  due: string;
  event_id: string;
  task_id: string;
}

const STRING = { type: "string" };

/** A strict object schema: every property is required and nothing else is allowed. */
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** Flat, with "" for a field that does not apply, like the desks' schema: no nullable unions to drift. */
export const ACTIONS_SCHEMA = {
  name: "quick_actions",
  schema: strictObject({
    actions: {
      type: "array",
      items: strictObject({
        kind: { type: "string", enum: [...ACTION_KINDS] },
        mail_ids: { type: "array", items: STRING },
        why: STRING,
        title: STRING,
        start: STRING,
        end: STRING,
        location: STRING,
        notes: STRING,
        due: STRING,
        event_id: STRING,
        task_id: STRING,
      }),
    },
  }),
};
