import { db, rssFeeds } from "../db";

export interface RssFeed {
  sourceName: string;
  url: string;
}

/** Feed rows are shared by the dashboard editor and the next one-shot pipeline run. */
export async function loadRssFeeds(): Promise<RssFeed[]> {
  return db.select({ sourceName: rssFeeds.sourceName, url: rssFeeds.url }).from(rssFeeds);
}
