import { daysAgo, DAY_MS } from "../util/time";
import { braveSearch, type BraveResult } from "./brave";
import { extractJson } from "../ai/openai";
import { db, notes, entities } from "../db";
import { eq, and, or, gte, isNull } from "drizzle-orm";
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
async function runSlot1(
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

// Slot 2: watched entity monitor. Watching is the explicit "alert me on this" correction
// (`importance = 'high'`, set from the entity detail page through the usual correction path);
// this was previously also gated on `status = 'dormant'`, which no writer ever reached on its
// own (nothing ever set `importance = 'high'` before the Watch control existed), so the slot had
// no candidate ever, in production, since launch.
async function runSlot2(runDate: string): Promise<WebSearchResult | null> {
  const tenDaysAgo = daysAgo(10);

  const watched = await db
    .select({ name: entities.name, lastMentioned: entities.lastMentioned, lastWatchSearch: entities.lastWatchSearch })
    .from(entities)
    .where(eq(entities.importance, "high"));

  // Absent for 10+ days: a watched entity still showing up in the briefing on its own doesn't
  // need a search to surface it. Among those, rotate by whichever was searched longest ago (or
  // never), so one target set early cannot monopolise the slot and the shared Brave quota.
  const eligible = watched
    .filter((e) => !e.lastMentioned || e.lastMentioned <= tenDaysAgo)
    .sort((a, b) => (a.lastWatchSearch ?? "") < (b.lastWatchSearch ?? "") ? -1 : 1);
  const candidate = eligible[0];
  if (!candidate) return null;

  const day = new Date(`${runDate}T00:00:00Z`);
  const month = day.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const query = `${candidate.name} news ${month} ${day.getUTCFullYear()}`;

  const { results } = await braveSearch(query, 5);
  await db.update(entities).set({ lastWatchSearch: runDate }).where(eq(entities.name, candidate.name));
  return { slot: 2, query, entityName: candidate.name, results };
}

// Slot 3: self/project reputation monitoring (rotating through notes with scope="search")
async function runSlot3(runDate: string): Promise<WebSearchResult | null> {
  const searchTargets = await db
    .select({ content: notes.content })
    .from(notes)
    .where(and(
      eq(notes.scope, "search"),
      isNull(notes.deletedAt),
      or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)),
    ));

  if (searchTargets.length === 0) return null;

  // Rotate by the run date's day-of-year, so a rerun of a day searches what that day did
  const day = new Date(`${runDate}T00:00:00Z`);
  const dayOfYear = Math.floor((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 0)) / DAY_MS);
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
