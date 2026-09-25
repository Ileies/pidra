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

/** A jump target for `SectionNav`: an element id and the label the control shows. */
export interface NavTarget {
  id: string;
  label: string;
}

/** Display order and presentation for Section 2's urgency groups (C3). */
export const URGENCY_META: Record<Urgency, { label: string; accent: string; tone: "error" | "warning" | "muted" | "neutral" }> = {
  critical: { label: "Critical", accent: "border-l-error-500", tone: "error" },
  high: { label: "High priority", accent: "border-l-warning-500", tone: "warning" },
  normal: { label: "Normal", accent: "border-l-surface-700", tone: "neutral" },
  mentions: { label: "Mentions", accent: "border-l-surface-700", tone: "muted" },
};
