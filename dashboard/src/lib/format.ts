/**
 * Every formatter in the dashboard.
 *
 * There were sixteen local ones across eight files - `fmtDate` four times with four different
 * option sets, plus `fmtDay`, `fmtTs` twice, `fmtNum` twice, `fmtScore` twice, `fmtPct` twice,
 * `fmtCost` and `fmtElapsed`. A date rendered differently depending on which page you were on.
 *
 * Locale is `en-GB` throughout, matching the English UI: day-month-year and a 24-hour clock, which is the
 * order the German output already used, without German month names. `sv-SE` survives in `isoDay`
 * only, where it is a trick for getting a local ISO date and not a locale choice.
 */

const LOCALE = "en-GB";

/** A dash, not an empty string: an absent value should be visibly absent in a table cell. */
export const EMPTY = "-";

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  // A bare `YYYY-MM-DD` parses as UTC midnight, which renders as the previous day west of
  // Greenwich. Noon local keeps a date-only value on its own day in every timezone.
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
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

/** "just now", "12 min", "3 h", "2 d": an age read at a glance, where `fmtDuration` is a measurement. */
export function fmtAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "2m 14s" since a timestamp. */
export function fmtElapsed(since: DateInput): string {
  const date = toDate(since);
  if (!date) return EMPTY;
  return fmtDuration(Date.now() - date.getTime());
}

/**
 * "$0.412". Takes dollars, not tokens: `costUsd()` in `#lib/pricing.js` is what turns token counts
 * into a figure, and it returns null when no price is configured. The old inline version
 * multiplied `gpt-5.6-luna` token counts by Sonnet's $3/$15 per Mtok, which made the one cost
 * number in the app wrong.
 */
export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return EMPTY;
  if (usd > 0 && usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(usd < 10 ? 3 : 2)}`;
}
