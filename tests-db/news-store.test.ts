// src/news/store.ts against real SQL: a desk's delivery and stories are stored whole or not at all,
// and a desk stored by an earlier run is reused. No mocks.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, notes, rawItems } = await import("../src/db");
const store = await import("../src/news/store");
const { DESKS, NEWS_SOURCE_TYPE, deskMessageId } = await import("../src/news/config");

const DAY = "2026-10-05";
const WINDOW = { start: "2026-10-04T05:00:00.000Z", end: "2026-10-05T05:00:00.000Z" };
const desk = (id: string) => DESKS.find((d) => d.id === id)!;

beforeEach(async () => {
  await database.sql`truncate raw_items, extractions, notes cascade`;
});

function story(headline: string, over: Record<string, unknown> = {}) {
  return {
    headline,
    summary: `${headline}, in short`,
    context: "background",
    significance: 4 as const,
    status: "new" as const,
    confidence: "confirmed" as const,
    region: "Switzerland",
    topic: "economy",
    happened_at: "2026-10-05",
    entities: ["Example Bank"],
    sources: [{ publisher: "Example News", title: headline, url: `https://news.example.com/${encodeURIComponent(headline)}` }],
    ...over,
  };
}

const validation = { verified: true, unverifiedUrls: [], inWindow: true, duplicateOf: null, alreadyReported: null };

function candidate(deskId: string, headline: string, over: Record<string, unknown> = {}, check: Record<string, unknown> = {}) {
  return { desk: deskId as never, deskOrder: DESKS.findIndex((d) => d.id === deskId), story: story(headline, over), validation: { ...validation, ...check }, stored: false };
}

function answer(deskId: string, stories: ReturnType<typeof story>[] = []) {
  return {
    desk: desk(deskId),
    stories,
    queries: ["swiss franc"],
    sources: ["https://news.example.com/a"],
    evidence: [],
    searchCalls: 2,
    aiCalls: 1,
    tokensIn: 10,
    tokensOut: 5,
    durationMs: 1234,
    prompt: { section: desk(deskId).section, version: null },
    model: "test-model",
  };
}

async function persistDesk(deskId: string, headlines: string[], runDate = DAY, window = WINDOW) {
  const candidates = headlines.map((h) => candidate(deskId, h));
  return store.persist(answer(deskId, candidates.map((c) => c.story)), candidates, runDate, window);
}

const extractionRows = async () =>
  (await database.sql`select e.extracted_json as json, e.relevance_score, e.effective_relevance, e.novelty, e.included_in_report, e.ai_failed, e.run_date, r.source_name from extractions e join raw_items r on r.id = e.raw_item_id order by e.created_at, e.id`) as {
    json: { headline: string; sources: { url: string }[]; desk: string };
    relevance_score: number;
    effective_relevance: number;
    novelty: string;
    included_in_report: boolean;
    ai_failed: boolean;
    run_date: string;
    source_name: string;
  }[];

describe("persist", () => {
  test("stores one delivery with the whole answer and one extraction per story", async () => {
    const stored = await store.persist(
      answer("world", []),
      [candidate("world", "Franc steadies", { significance: 5 }), candidate("world", "Rates held", { status: "update", significance: 2 })],
      DAY,
      WINDOW,
    );
    expect(stored).toBe(2);

    const [delivery] = await db.select().from(rawItems);
    expect(delivery).toMatchObject({ runDate: DAY, sourceType: NEWS_SOURCE_TYPE, sourceName: "news:world", messageId: deskMessageId(DAY, "world") });
    expect(new Date(delivery!.receivedAt as string).toISOString()).toBe(WINDOW.end);
    expect(delivery!.rawContent).toStartWith(`Title: ${desk("world").label}\nSource: news:world\nWindow: ${WINDOW.start} to ${WINDOW.end}\n\n{`);
    expect(JSON.parse(delivery!.rawContent!.split("\n\n")[1]!)).toMatchObject({ desk: "world", model: "test-model", searchCalls: 2, queries: ["swiss franc"], window: WINDOW });

    const rows = await extractionRows();
    const byHeadline = rows.map((r) => [r.json.headline, r.relevance_score, r.effective_relevance, r.novelty, r.included_in_report, r.ai_failed]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(byHeadline).toEqual([
      ["Franc steadies", 5, 5, "new", false, false],
      ["Rates held", 2, 2, "continuation", false, false],
    ]);
  });

  test("a cited URL the search never returned is not stored on the extraction", async () => {
    const real = "https://news.example.com/real";
    const made = "https://invented.example.com/fake";
    const c = candidate("home", "Local vote", { sources: [{ publisher: "A", title: "t", url: real }, { publisher: "B", title: "t", url: made }] }, { unverifiedUrls: [made] });
    await store.persist(answer("home", []), [c], DAY, WINDOW);
    expect((await extractionRows())[0]!.json.sources.map((s) => s.url)).toEqual([real]);
  });

  test("a desk already stored for the date keeps its record: the second delivery stores nothing", async () => {
    expect(await persistDesk("world", ["First story"])).toBe(1);
    expect(await persistDesk("world", ["Competing story", "Another"])).toBe(0);
    expect((await extractionRows()).map((r) => r.json.headline)).toEqual(["First story"]);
    expect(await db.select().from(rawItems)).toHaveLength(1);
  });

  test("a failing story insert rolls the whole desk back", async () => {
    const bad = candidate("world", "Broken story", { significance: "high" });
    await expect(store.persist(answer("world", []), [candidate("world", "Fine story"), bad], DAY, WINDOW)).rejects.toThrow();
    expect(await db.select().from(rawItems)).toHaveLength(0);
    expect(await extractionRows()).toHaveLength(0);
  });
});

describe("lastScanEnd", () => {
  test("is null on the very first run", async () => {
    expect(await store.lastScanEnd(DAY)).toBeNull();
  });

  test("is the newest earlier desk delivery, ignoring today and other source types", async () => {
    await persistDesk("world", ["Old"], "2026-10-03", { start: "2026-10-02T05:00:00.000Z", end: "2026-10-03T05:00:00.000Z" });
    await persistDesk("home", ["Yesterday"], "2026-10-04", { start: "2026-10-03T05:00:00.000Z", end: "2026-10-04T05:30:00.000Z" });
    await persistDesk("beat", ["Today"], DAY);
    await db.insert(rawItems).values({ runDate: "2026-10-04", sourceType: "email", sourceName: "x", messageId: "mail-1", rawContent: "x", receivedAt: "2026-10-04T23:00:00.000Z" });

    expect((await store.lastScanEnd(DAY))!.toISOString()).toBe("2026-10-04T05:30:00.000Z");
  });
});

describe("priorities", () => {
  test("lists live intel notes, oldest first, skipping deleted, expired and other scopes", async () => {
    const at = (day: string) => `${day}T08:00:00.000Z`;
    await db.insert(notes).values([
      { content: "second", scope: "intel", createdAt: at("2026-09-02") },
      { content: "first", scope: "intel", createdAt: at("2026-09-01"), expiresAt: DAY },
      { content: "never expires", scope: "intel", createdAt: at("2026-09-03") },
      { content: "expired", scope: "intel", createdAt: at("2026-09-01"), expiresAt: "2026-10-04" },
      { content: "trashed", scope: "intel", createdAt: at("2026-09-01"), deletedAt: at("2026-09-20") },
      { content: "personal one", scope: "personal", createdAt: at("2026-09-01") },
    ]);
    expect(await store.priorities(DAY)).toEqual(["first", "second", "never expires"]);
  });
});

describe("loadReusedDesks", () => {
  test("is empty when no desk has run for the date", async () => {
    await persistDesk("world", ["Another day"], "2026-10-04");
    const reused = await store.loadReusedDesks([...DESKS], DAY);
    expect([reused.window, reused.desks.size, reused.candidates.length, reused.counts.size]).toEqual([null, 0, 0, 0]);
  });

  test("returns the stored desks with their window, per-desk counts and stories as stored candidates", async () => {
    await persistDesk("home", ["Local one", "Local two"]);
    await persistDesk("world", ["Global one"]);
    await persistDesk("beat", ["Other day"], "2026-10-04");

    const reused = await store.loadReusedDesks([...DESKS], DAY);

    expect(reused.window).toEqual(WINDOW);
    expect([...reused.desks].sort()).toEqual(["home", "world"]);
    expect(Object.fromEntries(reused.counts)).toEqual({ home: 2, world: 1 });
    expect(reused.candidates.map((c) => [c.desk, c.deskOrder, c.story.headline, c.stored]).sort()).toEqual([
      ["home", DESKS.findIndex((d) => d.id === "home"), "Local one", true],
      ["home", DESKS.findIndex((d) => d.id === "home"), "Local two", true],
      ["world", DESKS.findIndex((d) => d.id === "world"), "Global one", true],
    ]);
    expect(reused.candidates[0]!.story.summary).toContain("in short");
  });

  test("only the requested desks are reused", async () => {
    await persistDesk("home", ["Local one"]);
    await persistDesk("world", ["Global one"]);
    const reused = await store.loadReusedDesks([desk("world")], DAY);
    expect([...reused.desks]).toEqual(["world"]);
    expect(reused.candidates.map((c) => c.story.headline)).toEqual(["Global one"]);
  });

  test("a desk that stored no stories is still reused, with a count of zero", async () => {
    await store.persist(answer("talk", []), [], DAY, WINDOW);
    const reused = await store.loadReusedDesks([...DESKS], DAY);
    expect([...reused.desks]).toEqual(["talk"]);
    expect(reused.counts.get("talk")).toBe(0);
  });
});
