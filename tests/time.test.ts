// src/util/time.ts: day arithmetic and wall-clock conversion. A date the runtime would roll over
// (2026-02-31 becomes March 3) must be rejected rather than booked on the wrong day.
import { describe, expect, test } from "bun:test";
import { addDays, daysAgo, isLocalDate, isTimeZone, localDay, timeZoneOrUtc, utcDay, zonedToIso } from "../src/util/time";

describe("isLocalDate", () => {
  test("accepts real calendar days, leap day included", () => {
    expect(isLocalDate("2026-10-05")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-12-31")).toBe(true);
  });

  test("rejects a day the month does not have, instead of rolling it into the next month", () => {
    expect(isLocalDate("2026-02-31")).toBe(false);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-04-31")).toBe(false);
    expect(isLocalDate("2026-06-00")).toBe(false);
  });

  test("rejects the wrong shape and impossible months", () => {
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-1-5")).toBe(false);
    expect(isLocalDate("tomorrow")).toBe(false);
    expect(isLocalDate("")).toBe(false);
  });
});

describe("zonedToIso", () => {
  test("reads a wall-clock time in the zone, winter and summer", () => {
    expect(zonedToIso("2026-01-15T14:00", "Europe/Berlin")).toBe("2026-01-15T13:00:00.000Z");
    expect(zonedToIso("2026-07-15T14:00", "Europe/Berlin")).toBe("2026-07-15T12:00:00.000Z");
    expect(zonedToIso("2026-07-15T14:00:30", "Europe/Berlin")).toBe("2026-07-15T12:00:30.000Z");
    expect(zonedToIso("2026-07-15T14:00", "UTC")).toBe("2026-07-15T14:00:00.000Z");
  });

  test("handles both DST switches in Europe/Berlin", () => {
    // Spring forward: 02:00 to 03:00 on 2026-03-29, so 01:30 is CET and 03:30 is CEST.
    expect(zonedToIso("2026-03-29T01:30", "Europe/Berlin")).toBe("2026-03-29T00:30:00.000Z");
    expect(zonedToIso("2026-03-29T03:30", "Europe/Berlin")).toBe("2026-03-29T01:30:00.000Z");
    // Fall back: 03:00 to 02:00 on 2026-10-25; 01:30 is still CEST, 03:30 is CET.
    expect(zonedToIso("2026-10-25T01:30", "Europe/Berlin")).toBe("2026-10-24T23:30:00.000Z");
    expect(zonedToIso("2026-10-25T03:30", "Europe/Berlin")).toBe("2026-10-25T02:30:00.000Z");
  });

  test("takes a value that carries an offset or Z as it stands", () => {
    expect(zonedToIso("2026-01-15T14:00:00Z", "Europe/Berlin")).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedToIso("2026-01-15T14:00:00+05:30", "Europe/Berlin")).toBe("2026-01-15T08:30:00.000Z");
    expect(zonedToIso("2026-01-15T14:00:00+0100", "UTC")).toBe("2026-01-15T13:00:00.000Z");
  });

  test("is null for text that is no time, and for one the clock does not have", () => {
    expect(zonedToIso("tomorrow", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-05", "UTC")).toBeNull();
    expect(zonedToIso("", "UTC")).toBeNull();
    expect(zonedToIso("2026-02-30T10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-13-01T10:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-05T25:00", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-05T10:61", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-05T10:00:75", "UTC")).toBeNull();
    expect(zonedToIso("2026-10-05T10:00+99:99", "UTC")).toBeNull();
  });
});

describe("day arithmetic", () => {
  test("addDays crosses months, years and the leap day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-05", 0)).toBe("2026-10-05");
  });

  test("daysAgo and utcDay work on the UTC day", () => {
    expect(daysAgo(3, new Date("2026-10-05T23:59:59Z"))).toBe("2026-10-02");
    expect(utcDay(new Date("2026-10-05T23:59:59Z"))).toBe("2026-10-05");
    expect(utcDay("2026-10-06T00:00:00+02:00")).toBe("2026-10-05");
  });

  test("localDay is the calendar day in the zone, not in UTC", () => {
    expect(localDay("2026-10-05T23:30:00Z", "Europe/Berlin")).toBe("2026-10-06");
    expect(localDay("2026-10-05T23:30:00Z")).toBe("2026-10-05");
    expect(localDay("2026-10-06T01:30:00Z", "America/New_York")).toBe("2026-10-05");
  });
});

describe("time zone names", () => {
  test("isTimeZone accepts IANA names and rejects everything else", () => {
    expect(isTimeZone("Europe/Zurich")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
    expect(isTimeZone("x".repeat(65))).toBe(false);
  });

  test("timeZoneOrUtc falls back to UTC for a zone from a client that is not one", () => {
    expect(timeZoneOrUtc("Europe/Zurich")).toBe("Europe/Zurich");
    expect(timeZoneOrUtc("nonsense")).toBe("UTC");
    expect(timeZoneOrUtc(undefined)).toBe("UTC");
  });
});
