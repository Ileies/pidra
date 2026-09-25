/**
 * The owner's wall clock. Every cron in the system already runs on it (`CLAUDE.md`, Cron
 * schedule), and a time read out of a mail ("Tuesday at 14:00") means this zone, not the zone
 * the server happens to run in.
 */
export const HOME_TIME_ZONE = "Europe/Berlin";

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Minutes `timeZone` is ahead of UTC at the instant `utcMs`. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - utcMs) / 60_000);
}

export function isLocalDate(value: string): boolean {
  return LOCAL_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * A wall-clock `YYYY-MM-DDTHH:MM` in `timeZone` as a UTC ISO instant, or null if it does not
 * parse. A value that already carries an offset or a `Z` is taken as it stands.
 *
 * `new Date("2026-09-30T14:00")` would read the time in the process's own zone, which on a
 * server running in UTC puts every event two hours late.
 */
export function zonedToIso(value: string, timeZone = HOME_TIME_ZONE): string | null {
  const trimmed = value.trim();
  const match = LOCAL_DATETIME.exec(trimmed);
  if (!match) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return null;
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  if (Number.isNaN(wall)) return null;
  // Twice: the offset at the wall time read as UTC can be the wrong side of a DST switch.
  let utc = wall - offsetMinutes(wall, timeZone) * 60_000;
  utc = wall - offsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc).toISOString();
}

/** `date` plus `days`, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** The calendar day an instant falls on in `timeZone`, as `YYYY-MM-DD`. */
export function localDay(iso: string, timeZone = HOME_TIME_ZONE): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone });
}
