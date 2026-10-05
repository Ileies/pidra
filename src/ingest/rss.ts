import { DAY_MS } from "../util/time";
import { errMessage } from "../util/text";
import Parser from "rss-parser";
import { eq } from "drizzle-orm";
import { db, rawItems, existingMessageIds, rssFeeds } from "../db";
import type { RssFeed } from "../config/rss-feeds";
import { removeFooter, stripHtml } from "./html";

// Phase 1 RSS ingest: polls the configured feeds (config/rss-feeds.ts, `rss_feeds` table) in
// parallel into `raw_items` as `newsletter` rows keyed on the item guid/link; records fetch health
// on `rss_feeds`. Failures are returned (`rss:<source>`), not thrown, so one feed cannot sink the run.
const parser = new Parser({ timeout: 15000 });

export interface RssIngestResult {
  count: number;
  failures: { source: string; error: string }[];
}

/** Body cap: an essay's argument fits, a 120k post does not cost 30k tokens twice. The mail path caps at 6000. */
const RSS_BODY_CHARS = 16000;

/**
 * The article itself where the feed carries it: Substack/WordPress put the full post in
 * `content:encoded` and only a teaser in `content`/`contentSnippet`. Picks the longer of the two.
 */
export function rssBody(item: Parser.Item): string {
  const encoded = (item as Parser.Item & { "content:encoded"?: unknown })["content:encoded"];
  const full = typeof encoded === "string" ? removeFooter(stripHtml(encoded)) : "";
  const short = (item.contentSnippet ?? item.content ?? item.summary ?? "").trim();
  const body = full.length > short.length ? full : short;
  return body.length > RSS_BODY_CHARS ? `${body.slice(0, RSS_BODY_CHARS)}\n[truncated]` : body;
}

function buildRawContent(item: Parser.Item, sourceName: string): string {
  const parts: string[] = [
    `Title: ${item.title ?? "(no title)"}`,
    `Source: ${sourceName}`,
  ];
  if (item.pubDate || item.isoDate) parts.push(`Published: ${item.pubDate ?? item.isoDate}`);
  if (item.link) parts.push(`Link: ${item.link}`);
  parts.push("");

  const body = rssBody(item);
  if (body) parts.push(body);

  return parts.join("\n");
}

async function ingestFeed(feedConfig: RssFeed, since: Date, runDate: string): Promise<number> {
  const { sourceName, url } = feedConfig;
  try {
    const feed = await parser.parseURL(url);
    const fresh = new Map<string, { item: Parser.Item; pubDate: Date | null }>();
    for (const item of feed.items) {
      const pubDate = item.isoDate ? new Date(item.isoDate) : (item.pubDate ? new Date(item.pubDate) : null);
      if (pubDate && pubDate < since) continue;

      const dedupKey = item.guid ?? item.link ?? null;
      if (dedupKey && !fresh.has(dedupKey)) fresh.set(dedupKey, { item, pubDate });
    }

    const known = await existingMessageIds([...fresh.keys()]);
    const rows = [...fresh].filter(([key]) => !known.has(key)).map(([messageId, { item, pubDate }]) => ({
      runDate,
      sourceType: "newsletter",
      sourceName,
      accountId: null,
      messageId,
      rawContent: buildRawContent(item, sourceName),
      receivedAt: pubDate?.toISOString() ?? new Date().toISOString(),
    }));
    // Feeds are polled in parallel, so another feed can carry the same guid; the unique message id
    // decides, and the loser is skipped rather than failing this feed.
    const inserted = rows.length === 0
      ? []
      : await db.insert(rawItems).values(rows).onConflictDoNothing({ target: rawItems.messageId }).returning({ id: rawItems.id });
    const stored = inserted.length;

    await db.update(rssFeeds).set({ lastError: null, lastErrorAt: null, lastSuccessAt: new Date().toISOString() })
      .where(eq(rssFeeds.sourceName, sourceName));
    return stored;
  } catch (err) {
    const error = errMessage(err).slice(0, 1000);
    console.warn(`[Ingest/RSS] [${sourceName}] Fetch failed: ${error}`);
    await db.update(rssFeeds).set({ lastError: error, lastErrorAt: new Date().toISOString() })
      .where(eq(rssFeeds.sourceName, sourceName));
    throw new Error(error);
  }
}

/** Env `RSS_LOOKBACK_DAYS` (default 14) sets the window. */
export async function ingestRssFeeds(runDate: string, feeds: RssFeed[]): Promise<RssIngestResult> {
  console.log(`[Ingest/RSS] Polling ${feeds.length} feeds`);

  // Weekly feeds sometimes stamp every item at midnight, before the next morning's run.
  // Global message ID deduplication makes a longer window safe and recovers short outages.
  const configured = Number(process.env.RSS_LOOKBACK_DAYS ?? 14);
  const lookbackDays = Number.isInteger(configured) && configured > 0 ? configured : 14;
  const since = new Date(Date.now() - lookbackDays * DAY_MS);

  const results = await Promise.allSettled(feeds.map((feed) => ingestFeed(feed, since, runDate)));
  let count = 0;
  const failures: RssIngestResult["failures"] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") count += result.value;
    else failures.push({ source: `rss:${feeds[i].sourceName}`, error: errMessage(result.reason) });
  }

  console.log(`[Ingest/RSS] Done - ${count} new items from ${feeds.length} feeds, ${failures.length} failed`);
  return { count, failures };
}
