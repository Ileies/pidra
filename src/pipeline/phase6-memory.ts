import { db, dailyReports, activeTopics, entities, contacts, notes, extractions, rawItems, sourceDailyScores, sourceQuality } from "../db";
import { eq, gte, and, sql as drizzleSql } from "drizzle-orm";
import type { SynthesisResult } from "./phase5-synthesis";

const avg = (nums: number[]) => nums.reduce((s, v) => s + v, 0) / nums.length;

function parseSystemBlock(text: string): Record<string, any> | null {
  const match = text.match(/<!--SYSTEM\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export async function runPhase6(
  runDate: string,
  synthesis: SynthesisResult,
  itemCount: number,
  itemsIncluded: number,
  questionGateFired = false,
): Promise<string> {
  console.log("[Phase 6] Writing memory and report");

  const fullReport = `# Morning Briefing — ${runDate}\n\n---\n\n${synthesis.section1}\n\n---\n\n${synthesis.section2}`;

  // Write daily report
  await db.insert(dailyReports).values({
    reportDate: runDate,
    fullReport,
    shortSummary: synthesis.section1.split("\n").slice(0, 5).join(" ").slice(0, 500),
    itemCount,
    itemsIncluded,
    itemsFiltered: itemCount - itemsIncluded,
    tokensIn: synthesis.tokensIn,
    tokensOut: synthesis.tokensOut,
    aiCalls: 2,
    questionGateFired,
  }).onConflictDoUpdate({
    target: dailyReports.reportDate,
    set: { fullReport, shortSummary: synthesis.section1.slice(0, 500), tokensIn: synthesis.tokensIn, tokensOut: synthesis.tokensOut },
  });

  // Parse and apply Section 1 SYSTEM block
  const s1System = parseSystemBlock(synthesis.section1);
  if (s1System) {
    for (const topic of s1System.new_topics ?? []) {
      await db.insert(activeTopics).values({
        headline: topic.headline,
        domain: topic.domain,
        runningSummary: topic.summary,
        firstSeen: runDate,
        lastUpdated: runDate,
        status: "active",
        updateCount: 1,
      }).onConflictDoNothing();
    }

    for (const update of s1System.updated_topics ?? []) {
      await db.update(activeTopics)
        .set({ runningSummary: update.new_summary, status: update.status, lastUpdated: runDate })
        .where(eq(activeTopics.id, update.id));
    }

    for (const entity of s1System.new_entities ?? []) {
      await db.insert(entities).values({
        name: entity.name,
        type: entity.type,
        domain: entity.domain,
        firstSeen: runDate,
        lastMentioned: runDate,
        mentionCount: 1,
        status: "active",
      }).onConflictDoNothing();
    }
  }

  // Parse and apply Section 2 SYSTEM block
  const s2System = parseSystemBlock(synthesis.section2);
  if (s2System) {
    for (const contact of s2System.new_contacts ?? []) {
      await db.insert(contacts).values({
        identifier: contact.identifier,
        name: contact.name,
        relationship: contact.relationship,
        priority: contact.priority ?? "normal",
      }).onConflictDoNothing();
    }

    for (const note of s2System.notes_to_write ?? []) {
      await db.insert(notes).values({
        content: note.content,
        scope: note.scope ?? "global",
        createdBy: "system",
      });
    }
  }

  await writeSourceDailyScores(runDate);

  console.log("[Phase 6] Done");
  return fullReport;
}

async function writeSourceDailyScores(runDate: string): Promise<void> {
  // Join extractions → raw_items for today, only newsletters with a sourceName
  const rows = await db
    .select({
      sourceName: rawItems.sourceName,
      relevanceScore: extractions.relevanceScore,
      effectiveRelevance: extractions.effectiveRelevance,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(rawItems.sourceType, "newsletter")));

  // Group by sourceName
  const bySource = new Map<string, { relevances: number[]; effectives: number[] }>();
  for (const row of rows) {
    if (!row.sourceName) continue;
    const entry = bySource.get(row.sourceName) ?? { relevances: [], effectives: [] };
    if (row.relevanceScore != null) entry.relevances.push(row.relevanceScore);
    if (row.effectiveRelevance != null) entry.effectives.push(row.effectiveRelevance);
    bySource.set(row.sourceName, entry);
  }

  for (const [sourceName, { relevances, effectives }] of bySource) {
    const itemsReceived = relevances.length;
    if (itemsReceived === 0) continue;

    const avgRelevance = avg(relevances);
    const avgEffectiveRelevance = effectives.length ? avg(effectives) : avgRelevance;
    const itemsIncluded = effectives.filter((v) => v >= 3).length;
    const includeRate = itemsIncluded / itemsReceived;
    // composite 0–10: quality-weighted (7pts) + breadth signal (3pts)
    const compositeScore = Math.min(10, (avgEffectiveRelevance / 5) * 7 + includeRate * 3);

    await db
      .insert(sourceDailyScores)
      .values({ sourceName, runDate, itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore })
      .onConflictDoUpdate({
        target: [sourceDailyScores.sourceName, sourceDailyScores.runDate],
        set: { itemsReceived, itemsIncluded, avgRelevance, avgEffectiveRelevance, includeRate, compositeScore },
      });

    // Recompute rolling 30-day composite for this source
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
    const window = await db
      .select({ compositeScore: sourceDailyScores.compositeScore, itemsReceived: sourceDailyScores.itemsReceived })
      .from(sourceDailyScores)
      .where(and(eq(sourceDailyScores.sourceName, sourceName), gte(sourceDailyScores.runDate, thirtyDaysAgo)));

    const totalWeight = window.reduce((s, r) => s + (r.itemsReceived ?? 1), 0);
    const weightedSum = window.reduce((s, r) => s + (r.compositeScore ?? 0) * (r.itemsReceived ?? 1), 0);
    const compositeScore30d = totalWeight > 0 ? weightedSum / totalWeight : null;

    await db
      .insert(sourceQuality)
      .values({ sourceName, compositeScore30d })
      .onConflictDoUpdate({ target: sourceQuality.sourceName, set: { compositeScore30d, updatedAt: drizzleSql`now()` } });
  }
}
