import { db, entities, entityRelations } from "../db";
import { and, eq, lt, sql as drizzleSql, lte } from "drizzle-orm";

// Archive low-importance entities dormant for 60+ days.
// Permanently delete archived entities absent for 180+ days with mention_count <= 2.
// Clean up orphaned entity relations.
export async function pruneEntityGraph(): Promise<void> {
  const today = new Date();
  const threshold60 = new Date(today.getTime() - 60 * 86400_000).toISOString().split("T")[0];
  const threshold180 = new Date(today.getTime() - 180 * 86400_000).toISOString().split("T")[0];

  // Archive: dormant low-importance entities not seen in 60+ days
  const archived = await db
    .update(entities)
    .set({ status: "archived" })
    .where(
      and(
        eq(entities.status, "dormant"),
        eq(entities.importance, "low"),
        lt(entities.lastMentioned, threshold60),
      )
    )
    .returning({ id: entities.id, name: entities.name });

  if (archived.length > 0) {
    console.log(`[entity-pruning] Archived ${archived.length} low-importance dormant entities`);
  }

  // Delete: archived entities absent 180+ days with very low mention count
  const toDelete = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(
      and(
        eq(entities.status, "archived"),
        lte(entities.mentionCount, 2),
        lt(entities.lastMentioned, threshold180),
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

  console.log(`[entity-pruning] Done — archived ${archived.length}, deleted ${toDelete.length}, removed ${deleted.length} orphaned relations`);
}
