/**
 * Entities the extraction graph keeps citing but has never been able to place.
 *
 * Question candidates for the Phase 4 gate (`phase4-questiongate.ts`). `type`/`domain` are set once at
 * insert and later writes never touch them (`phase6/entities.ts`), so a `domain` still empty after
 * 3+ mentions over 10+ days means the model never knew what the entity is. Mechanical: no model
 * call, and no output on a day where every recurring entity is understood.
 */
import { daysAgo } from "../util/time";
import { and, eq, inArray, or, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, entities } from "../db";
import type { CandidateInput } from "../questions/reconcile";

const MIN_MENTIONS = 3;
const MIN_AGE_DAYS = 10;

export async function lowConfidenceEntityCandidates(today: string, asked: ReadonlySet<string>): Promise<CandidateInput[]> {
  const threshold = daysAgo(MIN_AGE_DAYS);

  const rows = await db
    .select({ id: entities.id, name: entities.name, mentionCount: entities.mentionCount, firstSeen: entities.firstSeen })
    .from(entities)
    .where(
      and(
        inArray(entities.status, ["active", "dormant"]),
        drizzleSql`${entities.locked} IS NOT TRUE`,
        drizzleSql`COALESCE(${entities.mentionCount}, 0) >= ${MIN_MENTIONS}`,
        drizzleSql`${entities.firstSeen} IS NOT NULL AND ${entities.firstSeen} <= ${threshold}`,
        or(isNull(entities.domain), eq(entities.domain, "")),
      ),
    );

  if (rows.length === 0) return [];

  // Reuses the same "asked once, never again" dedup the mail path gets from a real extraction id -
  // an entity has no extraction to point at, so a synthetic `entity:<id>` fills that role.
  return rows
    .filter((e) => !asked.has(`entity:${e.id}`))
    .map((e) => ({
      kind: "item" as const,
      question: `${e.name} has come up ${e.mentionCount} times since ${e.firstSeen}, but I still don't have a clear sense of what it is - can you tell me?`,
      source: { extraction_id: `entity:${e.id}`, from: e.name, subject: null, source_type: "entity", run_date: today },
    }));
}
