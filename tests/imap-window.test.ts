import { describe, expect, test } from "bun:test";
import { imapSince } from "../src/ingest/imap-window";

/** How far back the daily IMAP ingest reads, relative to the last completed run. */

const now = new Date("2026-10-07T04:30:00Z");

describe("imapSince", () => {
  test("no earlier run reads the floor of one day", () => {
    expect(imapSince(now, null, 1).toISOString()).toBe("2026-10-06T04:30:00.000Z");
  });
  test("a normal daily cadence stays at one day", () => {
    expect(imapSince(now, new Date("2026-10-06T04:30:00Z"), 1).toISOString()).toBe("2026-10-06T04:30:00.000Z");
    expect(imapSince(now, new Date("2026-10-07T01:00:00Z"), 1).toISOString()).toBe("2026-10-06T04:30:00.000Z");
  });
  test("a missed day reaches back to the last run", () => {
    expect(imapSince(now, new Date("2026-10-05T04:30:00Z"), 1).toISOString()).toBe("2026-10-05T04:30:00.000Z");
  });
  test("a long outage is capped at three days", () => {
    expect(imapSince(now, new Date("2026-09-20T00:00:00Z"), 1).toISOString()).toBe("2026-10-04T04:30:00.000Z");
  });
  test("a configured lookback longer than the cap is the floor and the cap both", () => {
    expect(imapSince(now, new Date("2026-10-06T04:30:00Z"), 5).toISOString()).toBe("2026-10-02T04:30:00.000Z");
  });
});
