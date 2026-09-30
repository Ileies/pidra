import { inArray } from "drizzle-orm";
import { activeTopics, db } from "../db";

export const TOPIC_DORMANT_DAYS = 7;
export const TOPIC_ARCHIVE_DAYS = 30;
const REVIVABLE_LIMIT = 20;

type Topic = typeof activeTopics.$inferSelect;
type Story = { headline?: string; key_claim?: string; entities?: string[] };

function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

/** Status changes only follow the last actual story update, never a dashboard visit. */
export function agedTopicStatus(status: string | null, lastUpdated: string, runDate: string): "dormant" | "archived" | null {
  if (status === "active" && lastUpdated <= daysBefore(runDate, TOPIC_DORMANT_DAYS)) return "dormant";
  if (status === "dormant" && lastUpdated <= daysBefore(runDate, TOPIC_ARCHIVE_DAYS)) return "archived";
  return null;
}

/**
 * Give synthesis plausible old topics by matching names in today's claims. It makes the final
 * same-story decision; the shortlist only keeps the prompt from growing with the whole archive.
 */
export function revivableTopics(topics: Topic[], stories: Story[]): Topic[] {
  const text = stories.map((story) => `${story?.headline ?? ""} ${story?.key_claim ?? ""}`.toLowerCase());
  const entities = stories.flatMap((story) => Array.isArray(story?.entities) ? story.entities : [])
    .filter((name): name is string => typeof name === "string").map((name) => name.toLowerCase());
  const words = (value: string) => new Set((value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .filter((word) => !["about", "after", "amid", "from", "into", "more", "over", "that", "their", "this", "with", "year"].includes(word)));
  const storyWords = text.map(words);

  return topics.flatMap((topic) => {
    if (topic.status !== "dormant" && topic.status !== "archived") return [];
    const title = topic.headline.toLowerCase();
    const topicText = `${topic.headline} ${topic.runningSummary ?? ""}`.toLowerCase();
    const topicWords = words(title);
    const entityHit = entities.some((name) => name.length >= 4 && topicText.includes(name));
    const overlap = Math.max(0, ...storyWords.map((set) => [...topicWords].filter((word) => set.has(word)).length));
    if (!entityHit && overlap < 2) return [];
    return [{ topic, score: overlap + (entityHit ? 3 : 0) }];
  })
    .sort((a, b) => b.score - a.score || b.topic.lastUpdated.localeCompare(a.topic.lastUpdated))
    .slice(0, REVIVABLE_LIMIT)
    .map(({ topic }) => topic);
}

export async function ageTopics(runDate: string): Promise<void> {
  const rows = await db.select({ id: activeTopics.id, status: activeTopics.status, lastUpdated: activeTopics.lastUpdated })
    .from(activeTopics);
  const dormant = rows.filter((row) => agedTopicStatus(row.status, row.lastUpdated, runDate) === "dormant").map((row) => row.id);
  const archived = rows.filter((row) => agedTopicStatus(row.status, row.lastUpdated, runDate) === "archived").map((row) => row.id);
  if (dormant.length) {
    await db.update(activeTopics).set({ status: "dormant" }).where(inArray(activeTopics.id, dormant));
  }
  if (archived.length) {
    await db.update(activeTopics).set({ status: "archived" }).where(inArray(activeTopics.id, archived));
  }
  if (dormant.length || archived.length) {
    console.log(`[Phase 6] Topics: ${dormant.length} dormant, ${archived.length} archived`);
  }
}
