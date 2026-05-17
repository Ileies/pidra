import { db, dailyReports, activeTopics, entities, contacts, notes, extractions } from "../db";
import { eq, and } from "drizzle-orm";
import type { SynthesisResult } from "./phase5-synthesis";

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
  itemsIncluded: number
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
    questionGateFired: false,
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

  console.log("[Phase 6] Done");
  return fullReport;
}
