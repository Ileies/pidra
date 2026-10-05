// `active_topics` lifecycle rules (active -> dormant after 7 days -> archived after 30 without an
// update, capacity of 15 active topics, revival shortlist). Pure helpers used by Phase 3
// (`revivableTopics`), Phase 6 (`ageTopics`) and `phase6/system-block.ts` (capacity decisions).
import { addDays } from "../util/time";
import { inArray } from "drizzle-orm";
import { activeTopics, db } from "../db";

export const TOPIC_DORMANT_DAYS = 7;
export const TOPIC_ARCHIVE_DAYS = 30;
const REVIVABLE_LIMIT = 20;

// How many topics Section 1 carries as "active" at once. At capacity, a candidate (new or
// returning) only takes a slot by out-valuing the weakest occupant - see weakestActiveTopic/isMoreValuable.
export const TOPIC_ACTIVE_CAP = 15;

export type TopicImportance = "high" | "normal" | "low";
const IMPORTANCE_RANK: Record<TopicImportance, number> = { low: 0, normal: 1, high: 2 };

type Topic = typeof activeTopics.$inferSelect;
type Story = { headline?: string; key_claim?: string; entities?: string[] };
type RankedTopic = { importance: string | null; updateCount: number | null; lastUpdated: string };

export function normalizeTopicImportance(value: unknown): TopicImportance {
  return value === "high" || value === "low" ? value : "normal";
}

export function rankTopicImportance(importance: string | null | undefined): number {
  return IMPORTANCE_RANK[(importance as TopicImportance) ?? "normal"] ?? IMPORTANCE_RANK.normal;
}

/** Weakest by importance, tie-broken by less momentum: fewer carried-forward updates, then older. */
export function weakestActiveTopic<T extends RankedTopic>(topics: T[]): T | null {
  if (topics.length === 0) return null;
  return topics.reduce((weakest, topic) => {
    const rankDiff = rankTopicImportance(topic.importance) - rankTopicImportance(weakest.importance);
    if (rankDiff !== 0) return rankDiff < 0 ? topic : weakest;
    const countDiff = (topic.updateCount ?? 0) - (weakest.updateCount ?? 0);
    if (countDiff !== 0) return countDiff < 0 ? topic : weakest;
    return topic.lastUpdated < weakest.lastUpdated ? topic : weakest;
  });
}

/** Strict improvement only - a tie leaves the incumbent in its active slot. */
export function isMoreValuable(candidateImportance: string, incumbent: RankedTopic): boolean {
  return rankTopicImportance(candidateImportance) > rankTopicImportance(incumbent.importance);
}

/** Status changes only follow the last actual story update, never a dashboard visit. */
export function agedTopicStatus(status: string | null, lastUpdated: string, runDate: string): "dormant" | "archived" | null {
  if (status === "active" && lastUpdated <= addDays(runDate, -TOPIC_DORMANT_DAYS)) return "dormant";
  if (status === "dormant" && lastUpdated <= addDays(runDate, -TOPIC_ARCHIVE_DAYS)) return "archived";
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
