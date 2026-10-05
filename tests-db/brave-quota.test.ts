// The Brave daily quota (src/search/brave.ts `reserveDailyCall`) against real SQL: the upsert counts
// per UTC day, stops at 30, and holds when two processes race (a second copy of the module has its
// own request queue, so only the database is shared, as with two real processes). fetch and
// Bun.sleep are spies, so nothing waits and nothing leaves the machine.
import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
process.env.BRAVE_SEARCH_API_KEY = "test-key";
const first = await import("../src/search/brave");
const second = await import("../src/search/brave?second-process");

let fetched = 0;
let status = 200;
let fetchSpy: ReturnType<typeof spyOn>;
let sleepSpy: ReturnType<typeof spyOn>;

const calls = async (day: string) => ((await database.sql`select calls from brave_daily_usage where day = ${day}`)[0]?.calls ?? null) as number | null;
const setCalls = (day: string, n: number) => database.sql`insert into brave_daily_usage (day, calls) values (${day}, ${n}) on conflict (day) do update set calls = ${n}`;
const TODAY = "2026-10-05";

beforeEach(async () => {
  await database.sql`truncate brave_daily_usage`;
  fetched = 0;
  status = 200;
  setSystemTime(new Date("2026-10-05T12:00:00Z"));
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
    fetched++;
    return new Response(JSON.stringify({ web: { results: [] } }), { status });
  }) as unknown as typeof fetch);
  sleepSpy = spyOn(Bun, "sleep").mockImplementation((async () => {}) as typeof Bun.sleep);
});

afterEach(() => {
  setSystemTime();
  fetchSpy.mockRestore();
  sleepSpy.mockRestore();
});

describe("the daily counter", () => {
  test("the first search creates today's row at 1 and each further one adds 1", async () => {
    expect(await calls(TODAY)).toBeNull();
    await first.braveSearch("a");
    expect(await calls(TODAY)).toBe(1);
    await first.braveSearch("b");
    await first.braveContext("c");
    expect(await calls(TODAY)).toBe(3);
    expect(fetched).toBe(3);
  });

  test("a new UTC day starts at zero, and the day is the UTC one, not the local one", async () => {
    await setCalls(TODAY, 30);
    setSystemTime(new Date("2026-10-05T23:59:00Z"));
    await expect(first.braveSearch("late")).rejects.toThrow(/daily limit/);
    setSystemTime(new Date("2026-10-06T00:00:30Z"));
    await first.braveSearch("early");
    expect(await calls("2026-10-06")).toBe(1);
    expect(await calls(TODAY)).toBe(30);
  });
});

describe("the cap of 30", () => {
  test("the 30th call is allowed, the 31st is refused with no request sent and the counter left at 30", async () => {
    await setCalls(TODAY, 29);
    await first.braveSearch("thirtieth");
    expect(await calls(TODAY)).toBe(30);
    expect(fetched).toBe(1);

    await expect(first.braveSearch("thirty-first")).rejects.toThrow("Brave Search daily limit of 30 requests reached");
    await expect(first.braveContext("again")).rejects.toThrow(/daily limit/);
    expect(await calls(TODAY)).toBe(30);
    expect(fetched).toBe(1);
  });

  test("a refused reservation is final: no retry, so at most the one pacing wait", async () => {
    await setCalls(TODAY, 30);
    await expect(first.braveSearch("q")).rejects.toThrow(/daily limit/);
    // The clock is frozen, so the 1.1 s pacing wait fires on every request; a retry would add a second sleep.
    expect(sleepSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(fetched).toBe(0);
  });

  test("every retry of a failing request reserves its own call, and the retries stop when the quota runs out", async () => {
    status = 500;
    await setCalls(TODAY, 28);
    await expect(first.braveSearch("q")).rejects.toThrow(/daily limit/);
    expect(fetched).toBe(2);
    expect(await calls(TODAY)).toBe(30);
  });

  test("a request that fails for good still counts, and three attempts cost three calls", async () => {
    status = 500;
    await expect(first.braveSearch("q")).rejects.toThrow(/Brave Search error 500/);
    expect(fetched).toBe(3);
    expect(await calls(TODAY)).toBe(3);

    status = 400;
    await expect(first.braveSearch("q")).rejects.toThrow(/Brave Search error 400/);
    expect(fetched).toBe(4);
    expect(await calls(TODAY)).toBe(4);
  });
});

describe("two processes sharing the quota", () => {
  test("racing for the last calls, exactly the remaining number get through", async () => {
    await setCalls(TODAY, 20);
    const attempts = Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).braveSearch(`q${i}`).then(() => "ok", () => "refused"));
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((o) => o === "ok")).toHaveLength(10);
    expect(outcomes.filter((o) => o === "refused")).toHaveLength(10);
    expect(fetched).toBe(10);
    expect(await calls(TODAY)).toBe(30);
  });

  test("a fresh day's first calls from two processes racing create one row and count both", async () => {
    await Promise.all([first.braveSearch("a"), second.braveSearch("b"), first.braveSearch("c"), second.braveSearch("d")]);
    expect(await calls(TODAY)).toBe(4);
    expect(await database.sql`select count(*)::int as n from brave_daily_usage`).toEqual([{ n: 1 }]);
  });
});
