import { braveSearch, type BraveResult } from "./brave";
import { extractJson } from "../ai/openai";
import { db, notes, entities } from "../db";
import { eq, and } from "drizzle-orm";
import type { activeTopics } from "../db";

export interface WebSearchResult {
  slot: 1 | 2 | 3;
  query: string;
  topicId?: string;
  entityName?: string;
  target?: string;
  results: BraveResult[];
}

// Slot 1: top active topic deep-dive
export async function runSlot1(
  topics: (typeof activeTopics.$inferSelect)[],
  runDate: string,
): Promise<WebSearchResult | null> {
  const candidate = topics
    .filter((t) => t.status === "active")
    .sort((a, b) => (b.updateCount ?? 0) - (a.updateCount ?? 0))[0];

  if (!candidate) return null;

  const entityNames = (candidate.sources ?? []).slice(0, 3).join(", ");
  const { query } = await extractJson<{ query: string }>(
    "You generate short web search queries (max 8 words). Return JSON: { query: string }",
    `Active topic headline: ${candidate.headline}\nKey sources/entities: ${entityNames}\nToday: ${runDate}\n\nWrite a query to find today's most recent developments.`,
  );

  const { results } = await braveSearch(query, 5);
  return { slot: 1, query, topicId: candidate.id, results };
}

// Slot 2: dormant high-importance entity monitor
export async function runSlot2(runDate: string): Promise<WebSearchResult | null> {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400_000).toISOString().split("T")[0];

  const dormantEntities = await db
    .select({ name: entities.name, lastMentioned: entities.lastMentioned })
    .from(entities)
    .where(and(eq(entities.importance, "high"), eq(entities.status, "dormant")));

  // Filter to those actually absent for 10+ days
  const candidate = dormantEntities.find((e) => !e.lastMentioned || e.lastMentioned <= tenDaysAgo);
  if (!candidate) return null;

  const [month, year] = [
    new Date().toLocaleString("en-US", { month: "long" }),
    new Date().getFullYear(),
  ];
  const query = `${candidate.name} news ${month} ${year}`;

  const { results } = await braveSearch(query, 5);
  return { slot: 2, query, entityName: candidate.name, results };
}

// Slot 3: self/project reputation monitoring (rotating through notes with scope="search")
export async function runSlot3(runDate: string): Promise<WebSearchResult | null> {
  const searchTargets = await db
    .select({ content: notes.content })
    .from(notes)
    .where(eq(notes.scope, "search"));

  if (searchTargets.length === 0) return null;

  // Rotate by day-of-year index
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400_000);
  const target = searchTargets[dayOfYear % searchTargets.length].content;
  const query = `"${target}"`;

  const { results } = await braveSearch(query, 5);
  return { slot: 3, query, target, results };
}

export async function runAllSlots(
  topics: (typeof activeTopics.$inferSelect)[],
  runDate: string,
): Promise<WebSearchResult[]> {
  const [slot1, slot2, slot3] = await Promise.allSettled([
    runSlot1(topics, runDate),
    runSlot2(runDate),
    runSlot3(runDate),
  ]);

  const results: WebSearchResult[] = [];
  for (const r of [slot1, slot2, slot3]) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
    else if (r.status === "rejected") console.warn("[WebSearch] Slot failed:", r.reason);
  }

  console.log(`[WebSearch] ${results.length}/3 slot(s) returned results`);
  return results;
}
