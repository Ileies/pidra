import { daysAgo } from "../../util/time";
import { db, entities } from "../../db";
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";

export async function markDormantEntities(runDate: string): Promise<void> {
  const threshold = daysAgo(14);

  const result = await db
    .update(entities)
    .set({ status: "dormant" })
    // NULL-tolerant on purpose: `last_mentioned < date` is never TRUE for a NULL, so a row
    // inserted without one used to be permanently unreachable by every cleanup path. Locked rows
    // are skipped - `status` is one of the fields a `revise_context` correction owns once locked.
    .where(and(
      eq(entities.status, "active"),
      drizzleSql`${entities.locked} IS NOT TRUE`,
      drizzleSql`(last_mentioned IS NULL OR last_mentioned < ${threshold})`,
    ))
    .returning({ id: entities.id });

  // Reactivate any dormant *or archived* entity mentioned in today's run - archived rows used to
  // be permanently unreachable here even though a new mention is exactly the signal that should
  // bring one back - unless a correction locked its status on purpose.
  const reactivated = await db
    .update(entities)
    .set({ status: "active" })
    .where(and(
      inArray(entities.status, ["dormant", "archived"]),
      eq(entities.lastMentioned, runDate),
      drizzleSql`${entities.locked} IS NOT TRUE`,
    ))
    .returning({ id: entities.id });

  if (result.length > 0) {
    console.log(`[Phase 6] Marked ${result.length} entity(ies) as dormant (absent > 14 days)`);
  }
  if (reactivated.length > 0) {
    console.log(`[Phase 6] Reactivated ${reactivated.length} entity(ies) mentioned today`);
  }
}
