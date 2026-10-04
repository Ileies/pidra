/** Parsing for the loosely typed parameters a model (or the bridge) hands a skill. */
import type { calendar_v3 } from "googleapis";
import { isLocalDate, zonedToIso } from "../util/time";

/** An integer parameter from the model, clamped to `[min, max]`, or `fallback` when omitted. */
export function intParam(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} must be a whole number`);
  return Math.min(max, Math.max(min, n));
}

/** Booleans arrive as `true`, `"true"` or `"yes"` depending on how the model phrased the call. */
export function boolParam(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || /^(true|yes|1)$/i.test(String(value));
}

/** A comma, semicolon or whitespace separated list of email addresses, validated. */
export function emailList(value: unknown, name: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const emails = String(value).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${name}: "${email}" is not an email address`);
  }
  return [...new Set(emails)];
}

/** `all`, `externalOnly` or `none`: whether Google emails the attendees about the change. */
export function sendUpdatesParam(value: unknown): "all" | "externalOnly" | "none" {
  const v = String(value ?? "none").trim();
  if (v === "all" || v === "externalOnly" || v === "none") return v;
  throw new Error(`send_updates must be one of: all, externalOnly, none (got "${v}")`);
}

/** Refuses a destructive call when the model's idea of the title does not match the real one. */
export function assertExpectedTitle(expected: unknown, actual: string | null | undefined, kind: string): void {
  const want = String(expected ?? "").trim().toLowerCase();
  if (!want) return;
  if (!(actual ?? "").toLowerCase().includes(want)) {
    throw new Error(`Refused: that ${kind} is titled "${actual}", which does not contain expected_title "${expected}". Look it up again.`);
  }
}

/** Popup reminders, `minutes` before the start, from a comma separated list such as "10,60". */
export function reminderOverrides(value: unknown): calendar_v3.Schema$Event["reminders"] | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const text = String(value).trim().toLowerCase();
  if (text === "none") return { useDefault: false, overrides: [] };
  if (text === "default") return { useDefault: true };
  const minutes = text.split(/[\s,;]+/).filter(Boolean).map((m) => Number(m));
  if (minutes.some((m) => !Number.isInteger(m) || m < 0 || m > 40320)) {
    throw new Error('reminders_minutes must be whole minutes (0 to 40320) such as "10,60", or "none", or "default"');
  }
  return { useDefault: false, overrides: minutes.slice(0, 5).map((m) => ({ method: "popup", minutes: m })) };
}

/**
 * A skill's start or end as the Calendar API takes it: `YYYY-MM-DD` is a whole-day `date`,
 * anything else a `dateTime`. A time without an offset is read in `timeZone` (the caller's, not
 * the process's). The other field is sent as null so a patch can turn a timed event into a
 * whole-day one and back.
 */
export function eventTime(value: string, timeZone: string): calendar_v3.Schema$EventDateTime {
  const trimmed = value.trim();
  if (isLocalDate(trimmed)) return { date: trimmed, dateTime: null, timeZone };
  const iso = zonedToIso(trimmed, timeZone) ?? (Number.isNaN(Date.parse(trimmed)) ? null : new Date(trimmed).toISOString());
  if (!iso) throw new Error(`Not a date or time: "${value}"`);
  return { dateTime: iso, date: null, timeZone };
}
