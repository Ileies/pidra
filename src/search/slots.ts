// Section 1's two web-search slots (1: topic deep-dive, 3: reputation monitor), run by Phase 3
// (`pipeline/phase3-context.ts`) via `runAllSlots`. Each slot costs one Brave call from the shared
// daily quota (see brave.ts). The numbers are stable ids that the payloads and the dashboard use:
// slot 2 (watched entities) is gone and its number is not reused; slots 4 and 5 are deliberately not built.
import { DAY_MS } from "../util/time";
import { braveSearch, type BraveResult } from "./brave";
import { extractJson } from "../ai/openai";
import { recordLoads } from "../notes/loads";
import { notesForItem, selectStepNotes } from "../notes/select";
import type { activeTopics } from "../db";

export interface WebSearchResult {
  slot: 1 | 3;
  query: string;
  topicId?: string;
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

// Slot 3: self/project reputation monitoring (rotating through notes with scope="search")
async function runSlot3(runDate: string): Promise<WebSearchResult | null> {
  const searchTargets = notesForItem(await selectStepNotes("search", runDate));

  if (searchTargets.length === 0) return null;

  // Rotate by the run date's day-of-year, so a rerun of a day searches what that day did
  const day = new Date(`${runDate}T00:00:00Z`);
  const dayOfYear = Math.floor((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 0)) / DAY_MS);
  const picked = searchTargets[dayOfYear % searchTargets.length];
  const target = picked.content;
  await recordLoads("search", runDate, [picked]);
  const query = `"${target}"`;

  const { results } = await braveSearch(query, 5);
  return { slot: 3, query, target, results };
}

/** Never throws: a failed slot is logged and skipped, so the result has 0 to 3 entries. */
export async function runAllSlots(
  topics: (typeof activeTopics.$inferSelect)[],
  runDate: string,
): Promise<WebSearchResult[]> {
  const [slot1, slot3] = await Promise.allSettled([
    runSlot1(topics, runDate),
    runSlot3(runDate),
  ]);

  const results: WebSearchResult[] = [];
  for (const r of [slot1, slot3]) {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
    else if (r.status === "rejected") console.warn("[WebSearch] Slot failed:", r.reason);
  }

  console.log(`[WebSearch] ${results.length}/2 slot(s) returned results`);
  return results;
}
