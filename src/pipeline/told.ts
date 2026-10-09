/**
 * What the reader was already told on recent days, whichever section told them: a news-desk story
 * or a newsletter item cited in a report. The one memory the news desks and their repeat judge
 * read, so a story is not told again because it came back through the other door.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { NEWS_SOURCE_TYPE } from "../news/config";
import type { ReportedStory } from "../news/validate";
import { squash } from "../util/text";
import { addDays } from "../util/time";

/** News stories are remembered this long: a story that ran a fortnight ago is still a repeat. */
export const NEWS_TOLD_DAYS = 14;
/** Newsletter items repeat faster than they are worth remembering, so fewer days and no more than the cap. */
export const NEWSLETTER_TOLD_DAYS = 7;
const NEWSLETTER_TOLD_CAP = 150;
/** Only recent items carry their summary: it is what tells an update from a repeat, and it costs tokens. */
const SUMMARY_DAYS = 4;
const SUMMARY_CHARS = 160;

interface StoredClaim { headline?: string; key_claim?: string; sources?: { url: string }[] }

/**
 * Items cited in a report before `runDate`, oldest first. `urls` is only filled for news stories;
 * a newsletter item is compared by headline.
 */
export async function recentlyTold(runDate: string): Promise<ReportedStory[]> {
  const rows = await db
    .select({ runDate: extractions.runDate, sourceType: rawItems.sourceType, json: extractions.extractedJson })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(
      inArray(rawItems.sourceType, [NEWS_SOURCE_TYPE, "newsletter"]),
      eq(extractions.includedInReport, true),
      gte(extractions.runDate, addDays(runDate, -NEWS_TOLD_DAYS)),
      lt(extractions.runDate, runDate),
    ))
    .orderBy(extractions.runDate);

  const newsletterFrom = addDays(runDate, -NEWSLETTER_TOLD_DAYS);
  const summaryFrom = addDays(runDate, -SUMMARY_DAYS);
  const news: ReportedStory[] = [];
  const briefing: ReportedStory[] = [];
  for (const row of rows) {
    const json = row.json as StoredClaim | null;
    if (!json?.headline) continue;
    const isNews = row.sourceType === NEWS_SOURCE_TYPE;
    if (!isNews && row.runDate < newsletterFrom) continue;
    (isNews ? news : briefing).push({
      date: row.runDate,
      headline: json.headline,
      urls: isNews ? (json.sources ?? []).map((s) => s.url) : [],
      ...(row.runDate >= summaryFrom && json.key_claim ? { summary: squash(json.key_claim, SUMMARY_CHARS) } : {}),
    });
  }

  // The cap trims the oldest newsletter items, never a news story.
  return [...news, ...briefing.slice(-NEWSLETTER_TOLD_CAP)].sort((a, b) => a.date.localeCompare(b.date));
}
