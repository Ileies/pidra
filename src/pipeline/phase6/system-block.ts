import { db, activeTopics, entities, contacts } from "../../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createNote } from "../../notes/store";
import { validateNewContacts } from "../contact-suggestions";
import { processSkillSuggestions } from "./skill-suggestions";
import { TOPIC_ACTIVE_CAP, isMoreValuable, normalizeTopicImportance, rankTopicImportance, weakestActiveTopic } from "../topic-lifecycle";

export function parseSystemBlock(text: string): Record<string, any> | null {
  const match = text.match(/<!--SYSTEM\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function isValidTopicUpdate(update: any): boolean {
  if (typeof update.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(update.id)) return false;
  if (update.status !== "active" && update.status !== "resolved") return false;
  if (typeof update.new_summary !== "string" || !update.new_summary.trim()) return false;
  if (update.status === "resolved" && (typeof update.resolution_evidence !== "string" || !update.resolution_evidence.trim())) return false;
  return true;
}

async function applyTopicUpdate(update: any, runDate: string): Promise<void> {
  const patch: Record<string, unknown> = {
    runningSummary: update.new_summary.trim(),
    status: update.status,
    lastUpdated: runDate,
    updateCount: sql`CASE WHEN ${activeTopics.lastUpdated} < ${runDate} THEN COALESCE(${activeTopics.updateCount}, 0) + 1 ELSE ${activeTopics.updateCount} END`,
  };
  // Only touch importance when synthesis deliberately revised it; otherwise leave the existing rating.
  if (typeof update.importance === "string") patch.importance = normalizeTopicImportance(update.importance);
  await db.update(activeTopics)
    .set(patch)
    .where(and(eq(activeTopics.id, update.id), inArray(activeTopics.status, ["active", "dormant", "archived"])));
}

export async function applySection1SystemBlock(s1System: Record<string, any>, runDate: string): Promise<void> {
  const updates = (s1System.updated_topics ?? []).filter(isValidTopicUpdate);
  const targetIds = updates.filter((u: any) => u.status === "active").map((u: any) => u.id);
  const statusById = new Map(
    targetIds.length
      ? (await db.select({ id: activeTopics.id, status: activeTopics.status })
          .from(activeTopics).where(inArray(activeTopics.id, targetIds))).map((row) => [row.id, row.status])
      : [],
  );

  // Resolving or refreshing an already-active topic never changes the active count, so those
  // apply directly. A dormant/archived topic asking to go active is the same capacity question
  // as a brand-new topic, and is handled by the admission loop below alongside new_topics.
  const directUpdates = updates.filter((u: any) => u.status === "resolved" || statusById.get(u.id) === "active");
  for (const update of directUpdates) {
    await applyTopicUpdate(update, runDate);
  }
  const revivals = updates.filter((u: any) =>
    u.status === "active" && (statusById.get(u.id) === "dormant" || statusById.get(u.id) === "archived"));

  type Candidate = { importance: string; admit: () => Promise<void> };
  const candidates: Candidate[] = [
    ...(s1System.new_topics ?? []).map((topic: any): Candidate => ({
      importance: normalizeTopicImportance(topic.importance),
      admit: async () => {
        await db.insert(activeTopics).values({
          headline: topic.headline,
          domain: topic.domain,
          runningSummary: topic.summary,
          firstSeen: runDate,
          lastUpdated: runDate,
          status: "active",
          updateCount: 1,
          importance: normalizeTopicImportance(topic.importance),
        }).onConflictDoNothing();
      },
    })),
    ...revivals.map((update: any): Candidate => ({
      importance: normalizeTopicImportance(update.importance),
      admit: () => applyTopicUpdate(update, runDate),
    })),
  ].sort((a, b) => rankTopicImportance(b.importance) - rankTopicImportance(a.importance));

  if (candidates.length > 0) {
    const active = await db.select({
      id: activeTopics.id,
      importance: activeTopics.importance,
      updateCount: activeTopics.updateCount,
      lastUpdated: activeTopics.lastUpdated,
    }).from(activeTopics).where(eq(activeTopics.status, "active"));

    for (const candidate of candidates) {
      if (active.length < TOPIC_ACTIVE_CAP) {
        await candidate.admit();
        active.push({ id: "", importance: candidate.importance, updateCount: 1, lastUpdated: runDate });
        continue;
      }
      const weakest = weakestActiveTopic(active);
      // Candidates are processed strongest-first, so a placeholder admitted earlier this same
      // batch can never be out-valued by a later one - only a pre-existing row is ever demoted.
      if (weakest && isMoreValuable(candidate.importance, weakest)) {
        await db.update(activeTopics).set({ status: "dormant" }).where(eq(activeTopics.id, weakest.id));
        await candidate.admit();
        active.splice(active.indexOf(weakest), 1, { id: "", importance: candidate.importance, updateCount: 1, lastUpdated: runDate });
      }
    }
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
