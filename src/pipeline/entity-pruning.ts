import { db, entities, entityRelations } from "../db";
import { and, eq, sql as drizzleSql } from "drizzle-orm";

// Archive low-importance entities dormant for 60+ days.
// Permanently delete archived entities absent for 180+ days with mention_count <= 2.
// Clean up orphaned entity relations.
export async function pruneEntityGraph(): Promise<void> {
  const today = new Date();
  const threshold60 = new Date(today.getTime() - 60 * 86400_000).toISOString().split("T")[0];
  const threshold180 = new Date(today.getTime() - 180 * 86400_000).toISOString().split("T")[0];

  // Archive: dormant, not-important entities not seen in 60+ days.
  //
  // Two predicates here used to make this step a no-op. `importance = 'low'` is never written
  // by anything in the codebase (the column only ever holds 'normal' or 'high'), so the intent
  // - "do not archive an entity the user cares about" - is expressed as "not high" instead.
  // And `last_mentioned < date` silently skips NULLs, which is exactly the population that
  // most needs ageing out, so both thresholds are NULL-tolerant.
  const archived = await db
    .update(entities)
    .set({ status: "archived" })
    .where(
      and(
        eq(entities.status, "dormant"),
        drizzleSql`${entities.importance} IS DISTINCT FROM 'high'`,
        drizzleSql`(${entities.lastMentioned} IS NULL OR ${entities.lastMentioned} < ${threshold60})`,
      )
    )
    .returning({ id: entities.id, name: entities.name });

  if (archived.length > 0) {
    console.log(`[entity-pruning] Archived ${archived.length} dormant entities`);
  }

  // Delete: archived entities absent 180+ days with very low mention count
  const toDelete = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(
      and(
        eq(entities.status, "archived"),
        drizzleSql`COALESCE(${entities.mentionCount}, 0) <= 2`,
        drizzleSql`(${entities.lastMentioned} IS NULL OR ${entities.lastMentioned} < ${threshold180})`,
      )
    );

  if (toDelete.length > 0) {
    const ids = toDelete.map((e) => e.id);

    // Remove relations first (FK constraint)
    for (const id of ids) {
      await db
        .delete(entityRelations)
        .where(
          drizzleSql`from_id = ${id} OR to_id = ${id}`
        );
    }

    await db.delete(entities).where(drizzleSql`id = ANY(${ids})`);
    console.log(`[entity-pruning] Deleted ${toDelete.length} stale archived entities`);
  }

  // Orphaned relations: both endpoints must still exist
  const deleted = await db
    .delete(entityRelations)
    .where(
      drizzleSql`from_id NOT IN (SELECT id FROM entities) OR to_id NOT IN (SELECT id FROM entities)`
    )
    .returning({ id: entityRelations.id });

  if (deleted.length > 0) {
    console.log(`[entity-pruning] Removed ${deleted.length} orphaned entity relations`);
  }

  console.log(`[entity-pruning] Done - archived ${archived.length}, deleted ${toDelete.length}, removed ${deleted.length} orphaned relations`);
}
