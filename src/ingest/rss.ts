import Parser from "rss-parser";
import { db, rawItems } from "../db";
import { eq } from "drizzle-orm";
import { RSS_FEEDS } from "../config/rss-feeds";

const parser = new Parser({ timeout: 15000 });

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

async function ingestFeed(sourceName: string, feedUrl: string, since: Date, runDate: string): Promise<number> {
  let feed: Parser.Output<object>;
  try {
    feed = await parser.parseURL(feedUrl);
  } catch (err) {
    console.warn(`[Ingest/RSS] [${sourceName}] Fetch failed: ${err}`);
    return 0;
  }

  let stored = 0;
  for (const item of feed.items) {
    const pubDate = item.isoDate ? new Date(item.isoDate) : (item.pubDate ? new Date(item.pubDate) : null);
    if (pubDate && pubDate < since) continue;

    const dedupKey = item.guid ?? item.link ?? null;
    if (!dedupKey) continue;

    const existing = await db.select({ id: rawItems.id })
      .from(rawItems)
      .where(eq(rawItems.messageId, dedupKey))
      .limit(1);
    if (existing.length > 0) continue;

    const content = buildRawContent(item, sourceName);
    await db.insert(rawItems).values({
      runDate,
      sourceType: "newsletter",
      sourceName,
      accountId: null,
      messageId: dedupKey,
      rawContent: content,
      receivedAt: pubDate?.toISOString() ?? new Date().toISOString(),
    });
    stored++;
  }

  return stored;
}

export async function ingestRssFeeds(runDate: string): Promise<number> {
  console.log(`[Ingest/RSS] Polling ${Object.keys(RSS_FEEDS).length} feeds`);

  const lookbackDays = parseInt(process.env.IMAP_LOOKBACK_DAYS ?? "1");
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const results = await Promise.allSettled(
    Object.entries(RSS_FEEDS).map(([name, url]) => ingestFeed(name, url, since, runDate))
  );

  let total = 0;
  for (const r of results) {
    if (r.status === "fulfilled") total += r.value;
  }

  console.log(`[Ingest/RSS] Done — ${total} new items from ${Object.keys(RSS_FEEDS).length} feeds`);
  return total;
}
