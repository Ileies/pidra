/**
 * Every formatter in the dashboard (dates, numbers, durations, cost): never format inline in a
 * page. Every function returns `EMPTY` for null/undefined/unparseable input.
 *
 * Locale is `en-GB` throughout (day-month-year, 24-hour clock). `sv-SE` is used in `isoDay`
 * only, as a trick for getting a local ISO date and not a locale choice.
 */

import { isDateKey } from "$pipeline/util/ids";

const LOCALE = "en-GB";

/** A dash, not an empty string: an absent value should be visibly absent in a table cell. */
export const EMPTY = "-";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  // A bare `YYYY-MM-DD` parses as UTC midnight, which renders as the previous day west of
  // Greenwich. Noon local keeps a date-only value on its own day in every timezone.
  const date = typeof value === "string" && isDateKey(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 Sep 2026" */
export function fmtDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, { day: "2-digit", month: "short", year: "numeric" });
}

/** "12 Sep 2026, 14:05" */
export function fmtDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "12 Sep, 14:05" - for lists where the year is noise. */
export function fmtDateTimeShort(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "14:05:33" */
export function fmtTime(value: DateInput, withSeconds = true): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
}

/** "Tue 30 Sep", with the year only when it is not this one. */
export function fmtDay(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleDateString(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  });
}

/** "just now", "5m ago", "3h ago", "2d ago", then "12 Sep" (with the year when it is not this one). */
export function fmtAgo(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  });
}

/** Day-granular recency for date-only values: "today", "yesterday", "5d ago", then "12 Sep 2026". */
export function fmtDaysAgo(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return fmtDate(value);
}

/**
 * When something happens: "Tue 30 Sep, 14:00–15:00", "Tue 30 Sep, 22:00 – Wed 1 Oct, 02:00", or
 * for whole days "Tue 30 Sep" and "Tue 30 Sep – Thu 2 Oct". A whole-day `end` is the last day.
 */
export function fmtSpan(start: DateInput, end: DateInput, allDay: boolean): string {
  if (!toDate(start)) return EMPTY;
  if (allDay) {
    return !toDate(end) || isoDay(end) === isoDay(start) ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
  }
  const from = `${fmtDay(start)}, ${fmtTime(start, false)}`;
  if (!toDate(end)) return from;
  return isoDay(end) === isoDay(start) ? `${from}–${fmtTime(end, false)}` : `${from} – ${fmtDay(end)}, ${fmtTime(end, false)}`;
}

/** Local calendar date as `YYYY-MM-DD`. `sv-SE` is the shortest way to get one without UTC drift. */
export function isoDay(value: DateInput = new Date()): string {
  return (toDate(value) ?? new Date()).toLocaleDateString("sv-SE");
}

/** The UTC calendar day, `YYYY-MM-DD`: what a briefing is dated by, wherever the reader is. */
export function utcDay(value: DateInput = new Date()): string {
  return (toDate(value) ?? new Date()).toISOString().slice(0, 10);
}

/** Grouped integer, "1,432". */
export function fmtNum(value: number | null | undefined): string {
  if (value == null) return EMPTY;
  return value.toLocaleString(LOCALE);
}

/** "68%" */
export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value == null) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

/** "7.4" - a score on its own, without the "/10" suffix the caller decides on. */
export function fmtScore(value: number | null | undefined, digits = 1): string {
  if (value == null) return EMPTY;
  return value.toFixed(digits);
}

/** "2m 14s" from a millisecond duration. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return EMPTY;
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

/** Sub-second precision for short spans: "850 ms", "4.2s", then the `fmtDuration` shapes. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return fmtDuration(ms);
}

/** "2m 14s" since a timestamp, or between two when `until` is given (a finished run stops counting). */
export function fmtElapsed(since: DateInput, until?: DateInput): string {
  const date = toDate(since);
  if (!date) return EMPTY;
  const end = toDate(until)?.getTime() ?? Date.now();
  return fmtDuration(end - date.getTime());
}

/**
 * "$0.412". Takes dollars, not tokens: `costUsd()` in `#lib/pricing.js` is what turns token counts
 * into a figure, and it returns null when no price is configured.
 */
export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return EMPTY;
  if (usd > 0 && usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(usd < 10 ? 3 : 2)}`;
}

/** Text colour for a 0-10 composite score: green from 7.5, amber from 5, red below, muted when there is none. */
export function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-surface-400";
  if (score >= 7.5) return "text-success-500";
  if (score >= 5) return "text-warning-500";
  return "text-error-500";
}
