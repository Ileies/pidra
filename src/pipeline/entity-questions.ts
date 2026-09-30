/**
 * Entities the extraction graph keeps citing but has never been able to place.
 *
 * `type`/`domain` are set once, at insert, and every later write to an existing entity is
 * explicitly barred from touching them (`phase6/entities.ts`) - they stay owned by whatever the
 * first newsletter's graph guessed, or by a `revise_context` correction. So a `domain` that is
 * still empty after several separate newsletters, spread over more than a few days, is not a
 * stale value or a rerun artifact: it is the model saying, every time, that it does not know what
 * this thing is. That is a mechanical, self-limiting signal of genuine uncertainty - no schema
 * change, no extra model call, and it produces nothing on a day where every recurring entity is
 * already well understood.
 */
import { and, eq, inArray, or, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, entities } from "../db";
import type { CandidateInput } from "../questions/reconcile";
import { askedExtractionIds } from "../questions/store";

const MIN_MENTIONS = 3;
const MIN_AGE_DAYS = 10;

export async function lowConfidenceEntityCandidates(today: string): Promise<CandidateInput[]> {
  const threshold = new Date(Date.now() - MIN_AGE_DAYS * 86400_000).toISOString().split("T")[0];

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
  const asked = await askedExtractionIds();
  return rows
    .filter((e) => !asked.has(`entity:${e.id}`))
    .map((e) => ({
      kind: "item" as const,
      question: `${e.name} has come up ${e.mentionCount} times since ${e.firstSeen}, but I still don't have a clear sense of what it is - can you tell me?`,
      source: { extraction_id: `entity:${e.id}`, from: e.name, subject: null, source_type: "entity", run_date: today },
    }));
}
