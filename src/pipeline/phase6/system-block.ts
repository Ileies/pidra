import { db, activeTopics, entities, contacts } from "../../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createNote } from "../../notes/store";
import { validateNewContacts } from "../contact-suggestions";
import { processSkillSuggestions } from "./skill-suggestions";

export function parseSystemBlock(text: string): Record<string, any> | null {
  const match = text.match(/<!--SYSTEM\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export async function applySection1SystemBlock(s1System: Record<string, any>, runDate: string): Promise<void> {
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
    if (typeof update.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(update.id)) continue;
    if (update.status !== "active" && update.status !== "resolved") continue;
    if (typeof update.new_summary !== "string" || !update.new_summary.trim()) continue;
    if (update.status === "resolved" && (typeof update.resolution_evidence !== "string" || !update.resolution_evidence.trim())) continue;
    await db.update(activeTopics)
      .set({
        runningSummary: update.new_summary.trim(),
        status: update.status,
        lastUpdated: runDate,
        updateCount: sql`CASE WHEN ${activeTopics.lastUpdated} < ${runDate} THEN COALESCE(${activeTopics.updateCount}, 0) + 1 ELSE ${activeTopics.updateCount} END`,
      })
      .where(and(eq(activeTopics.id, update.id), inArray(activeTopics.status, ["active", "dormant", "archived"])));
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

  await processSkillSuggestions(s1System.skill_suggestions ?? [], runDate, "report_section");
}

export async function applySection2SystemBlock(s2System: Record<string, any>): Promise<void> {
  const { contacts: newContacts, skipped } = validateNewContacts(s2System.new_contacts);
  if (skipped > 0) {
    console.warn(`[Phase 6] Skipped ${skipped} invalid new_contacts suggestion(s); identifier is required`);
  }
  for (const contact of newContacts) {
    await db.insert(contacts).values({
      identifier: contact.identifier,
      name: contact.name,
      relationship: contact.relationship,
      priority: contact.priority ?? "normal",
    }).onConflictDoNothing();
  }

  for (const note of s2System.notes_to_write ?? []) {
    // Through the store, so a pipeline-written note is editable and reversible like any other.
    // A malformed one is skipped rather than allowed to fail the step.
    try {
      await createNote({ content: note.content, scope: note.scope ?? "global" }, { by: "system" });
    } catch (err) {
      console.warn(`[Phase 6] Skipped a note from the SYSTEM block: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
