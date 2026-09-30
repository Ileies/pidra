import Parser from "rss-parser";
import { eq } from "drizzle-orm";
import { db, rawItems, rawItemExists, rssFeeds } from "../db";
import type { RssFeed } from "../config/rss-feeds";

const parser = new Parser({ timeout: 15000 });

export interface RssIngestResult {
  count: number;
  failures: { source: string; error: string }[];
}

function buildRawContent(item: Parser.Item, sourceName: string): string {
  const parts: string[] = [
    `Title: ${item.title ?? "(no title)"}`,
    `Source: ${sourceName}`,
  ];
  if (item.pubDate || item.isoDate) parts.push(`Published: ${item.pubDate ?? item.isoDate}`);
  if (item.link) parts.push(`Link: ${item.link}`);
  parts.push("");

  const body = item.contentSnippet ?? item.content ?? item.summary ?? "";
  if (body) parts.push(body.trim());

  return parts.join("\n");
}

async function ingestFeed(feedConfig: RssFeed, since: Date, runDate: string): Promise<number> {
  const { sourceName, url } = feedConfig;
  try {
    const feed = await parser.parseURL(url);
    let stored = 0;
    for (const item of feed.items) {
      const pubDate = item.isoDate ? new Date(item.isoDate) : (item.pubDate ? new Date(item.pubDate) : null);
      if (pubDate && pubDate < since) continue;

      const dedupKey = item.guid ?? item.link ?? null;
      if (!dedupKey || await rawItemExists(dedupKey)) continue;

      await db.insert(rawItems).values({
        runDate,
        sourceType: "newsletter",
        sourceName,
        accountId: null,
        messageId: dedupKey,
        rawContent: buildRawContent(item, sourceName),
        receivedAt: pubDate?.toISOString() ?? new Date().toISOString(),
      });
      stored++;
    }

    await db.update(rssFeeds).set({ lastError: null, lastErrorAt: null, lastSuccessAt: new Date().toISOString() })
      .where(eq(rssFeeds.sourceName, sourceName));
    return stored;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.warn(`[Ingest/RSS] [${sourceName}] Fetch failed: ${error}`);
    await db.update(rssFeeds).set({ lastError: error, lastErrorAt: new Date().toISOString() })
      .where(eq(rssFeeds.sourceName, sourceName));
    throw new Error(error);
  }
}

export async function ingestRssFeeds(runDate: string, feeds: RssFeed[]): Promise<RssIngestResult> {
  console.log(`[Ingest/RSS] Polling ${feeds.length} feeds`);

  // Weekly feeds sometimes stamp every item at midnight, before the next morning's run.
  // Global message ID deduplication makes a longer window safe and recovers short outages.
  const configured = Number(process.env.RSS_LOOKBACK_DAYS ?? 14);
  const lookbackDays = Number.isInteger(configured) && configured > 0 ? configured : 14;
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const results = await Promise.allSettled(feeds.map((feed) => ingestFeed(feed, since, runDate)));
  let count = 0;
  const failures: RssIngestResult["failures"] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") count += result.value;
    else failures.push({ source: `rss:${feeds[i].sourceName}`, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  }

  console.log(`[Ingest/RSS] Done - ${count} new items from ${feeds.length} feeds, ${failures.length} failed`);
  return { count, failures };
}
