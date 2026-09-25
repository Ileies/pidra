/**
 * The report contract, dashboard side.
 *
 * Mirrors `src/pipeline/report-json.ts`, which is the authority: the pipeline writes this shape
 * into `daily_reports.report_json` and the dashboard reads it. The two packages do not share a
 * module - the dashboard talks to Postgres and to the bridge, never to the pipeline's source -
 * so this is a deliberate, documented copy, kept to the same field names.
 *
 * `version` exists so a future shape change can be detected rather than mis-rendered.
 */

export const REPORT_JSON_VERSION = 2;

export type Urgency = "critical" | "high" | "normal" | "mentions";

export interface ReportEntry {
  md: string;
  refIds: string[];
}

export interface ReportJson {
  version: number;
  date: string;
  personal: { urgency: Urgency; entries: ReportEntry[] }[];
  /** The News section, grouped under the editor's headings. Absent on a version-1 row. */
  news?: { group: string; entries: ReportEntry[] }[];
  intel: { domain: string; entries: ReportEntry[] }[];
  alsoNoted: ReportEntry[];
}

/**
 * A quick action: a one-tap button beside a personal entry. Mirrors `ActionPreview` and the
 * `report_actions` row in the pipeline (`src/actions/`), which is the authority, the same
 * deliberate copy as the report shape above.
 *
 * Timed `start`/`end` are UTC instants; a whole-day `end` is the last day, inclusive.
 */
export type ActionPreview =
  | { kind: "add_event"; title: string; start: string; end: string; allDay: boolean; location: string | null }
  | {
      kind: "update_event";
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      location: string | null;
      was: { start: string; end: string; allDay: boolean; location: string | null };
    }
  | { kind: "add_todo"; title: string; due: string | null; notes: string | null }
  | { kind: "complete_todo"; title: string; list: string };

/** `discarded` rows never leave the server, and dismissed ones are not mirrored. */
export type ActionStatus = "proposed" | "running" | "done" | "failed" | "queued";

export interface QuickAction {
  id: string;
  status: ActionStatus;
  preview: ActionPreview;
  /** The agent's one line on what the mail asks, shown when no report entry carries the action. */
  reason: string | null;
  /**
   * The mails behind it, matched against an entry's `refIds`. No error text travels with an
   * action: like `step_errors`, it stays on the server, and a tap reads it from its own response.
   */
  sourceIds: string[];
}

/** A jump target for `SectionNav`: an element id and the label the control shows. */
export interface NavTarget {
  id: string;
  label: string;
}

/** What a quick action's button says, before and after the tap. */
export const ACTION_META: Record<ActionPreview["kind"], { verb: string; done: string }> = {
  add_event: { verb: "Add to calendar", done: "Added to calendar" },
  update_event: { verb: "Update event", done: "Event updated" },
  add_todo: { verb: "Add to to-do", done: "Added to to-do" },
  complete_todo: { verb: "Mark done", done: "Marked done" },
};

/** Display order and presentation for Section 2's urgency groups (C3). */
export const URGENCY_META: Record<Urgency, { label: string; accent: string; tone: "error" | "warning" | "muted" | "neutral" }> = {
  critical: { label: "Critical", accent: "border-l-error-500", tone: "error" },
  high: { label: "High priority", accent: "border-l-warning-500", tone: "warning" },
  normal: { label: "Normal", accent: "border-l-surface-700", tone: "neutral" },
  mentions: { label: "Mentions", accent: "border-l-surface-700", tone: "muted" },
};
