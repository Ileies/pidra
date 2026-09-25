/**
 * Display labels for database values.
 *
 * Enums stay English in Postgres and are given their display form here, so `novelty:
 * "continuation"` renders as "Continuation" without a second translation layer and without a
 * per-page label map. Four pages carried their own before this file existed.
 *
 * A value with no entry falls back to itself, capitalised, which is the right answer for most
 * of them and keeps a new enum value from rendering as a blank.
 */

const LABELS: Record<string, string> = {
  // extraction novelty
  new: "New",
  continuation: "Continuation",
  repeat: "Repeat",

  // urgency
  critical: "Critical",
  high: "High priority",
  normal: "Normal",
  low: "Low",
  mentions: "Mentions",

  // entity status and importance
  active: "Active",
  dormant: "Dormant",
  archived: "Archived",
  medium: "Medium",

  // skill risk and execution status
  pending: "Pending",
  executed: "Executed",
  failed: "Failed",
  rejected: "Rejected",
  running: "Running",
  completed: "Completed",
  idle: "Idle",

  // source quality trend
  improving: "Improving",
  declining: "Declining",
  stable: "Stable",

  // note scopes
  global: "Global",
  intel: "Intel",
  personal: "Personal",
  contact: "Contact",
  search: "Search",

  // extraction skip reasons
  promotional: "Promotional or automated",

  // Phase 3 gate verdicts (src/pipeline/gate.ts)
  below_threshold: "Scored under the bar",
  skipped_by_extraction: "Extraction found nothing to report",
  extraction_failed: "The extraction call failed",
  spam: "Classified as spam",
  general_news: "General news, not personal",
  automated_low_urgency: "Automated and not urgent",
  unverified_source: "No source the search actually returned",
  outside_window: "Happened before the news window",
  duplicate: "Same story as another desk's",
  already_reported: "Already reported on an earlier day",
  not_gated: "Not subject to the gate",

  // news desks (src/news/desks.ts), as `raw_items.source_name` names them
  "news:world": "World news desk",
  "news:home": "Home news desk",
  "news:beat": "Beat news desk",
  "news:field": "Fields news desk",
  "news:talk": "Talk of the day desk",
  "news:serendipity": "Something different desk",
  news: "News desks",

  // news story confidence
  confirmed: "Confirmed",
  reported: "Reported",
  unconfirmed: "Unconfirmed",

  // ingest drop reasons (src/ingest/imap.ts)
  substack_system: "Substack system notification",
  ignored_sender: "Sender on this account's ignore list",
  covered_by_rss: "Already covered by the RSS feed",
  empty_content: "Nothing left after the HTML was stripped",

  // who made a change
  user: "You",
  chat: "The assistant",
  system: "The system",

  // context correction operations
  add: "Added",
  correct: "Corrected",
  remove: "Removed",
  reverted: "Reverted",

  // context builder run modes
  full: "Full",
  update: "Update",
};

/** Trend glyphs. Always rendered beside the word, never instead of it (A4). */
export const TREND_GLYPH: Record<string, string> = {
  improving: "↑",
  declining: "↓",
  stable: "→",
};

export function label(value: string | null | undefined, fallback = "-"): string {
  if (!value) return fallback;
  return LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
