// src/pipeline/told.ts against real SQL: what the reader was told on the last days, from the news
// section and from the briefing, and how far back each is remembered. No mocks.
import { beforeEach, describe, expect, test } from "bun:test";
import { useTestDatabase } from "./fixtures/database";

const database = await useTestDatabase();
const { db, extractions, rawItems } = await import("../src/db");
const { recentlyTold } = await import("../src/pipeline/told");

const DAY = "2026-10-20";

beforeEach(async () => {
  await database.sql`truncate raw_items, extractions cascade`;
});

let seq = 0;
async function told(sourceType: "web_news" | "newsletter", runDate: string, json: Record<string, unknown>, included = true) {
  const [raw] = await db.insert(rawItems).values({
    runDate, sourceType, sourceName: sourceType === "web_news" ? "news:world" : "Letter", messageId: `m-${++seq}`, rawContent: "x", receivedAt: `${runDate}T05:00:00.000Z`,
  }).returning({ id: rawItems.id });
  await db.insert(extractions).values({ rawItemId: raw.id, runDate, extractedJson: json, includedInReport: included, aiFailed: false });
}

const news = (headline: string) => ({ headline, key_claim: `${headline}, in short`, sources: [{ url: `https://news.example.com/${encodeURIComponent(headline)}` }] });
const letter = (headline: string) => ({ headline, key_claim: `${headline}, in short` });

describe("recentlyTold", () => {
  test("remembers news for two weeks and newsletter items for one, never today or an item the reader did not see", async () => {
    await told("web_news", "2026-10-07", news("News 13 days ago"));
    await told("web_news", "2026-10-05", news("News 15 days ago"));
    await told("newsletter", "2026-10-14", letter("Letter 6 days ago"));
    await told("newsletter", "2026-10-12", letter("Letter 8 days ago"));
    await told("web_news", "2026-10-19", news("Unseen news"), false);
    await told("web_news", DAY, news("Today"));

    expect((await recentlyTold(DAY)).map((t) => t.headline)).toEqual(["News 13 days ago", "Letter 6 days ago"]);
  });

  test("gives recent items a summary and the older ones only a headline", async () => {
    await told("web_news", "2026-10-19", news("Yesterday"));
    await told("newsletter", "2026-10-10", letter("Ten days ago"));
    await told("web_news", "2026-10-10", news("Ten days ago too"));

    const result = await recentlyTold(DAY);
    expect(result.map((t) => [t.headline, t.summary])).toEqual([
      ["Ten days ago too", undefined],
      ["Yesterday", "Yesterday, in short"],
    ]);
    expect(result[1]!.urls[0]).toStartWith("https://news.example.com/");
  });

  test("keeps every news story but caps the newsletter items, dropping the oldest", async () => {
    for (let i = 0; i < 155; i++) await told("newsletter", "2026-10-15", letter(`Letter ${i}`));
    await told("web_news", "2026-10-10", news("Old news"));

    const result = await recentlyTold(DAY);
    expect(result).toHaveLength(151);
    expect(result[0]!.headline).toBe("Old news");
  });

  test("skips an extraction that has no headline", async () => {
    await told("newsletter", "2026-10-19", { skip_reason: "ad" });
    expect(await recentlyTold(DAY)).toEqual([]);
  });
});
