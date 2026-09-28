import { db, entities } from "../../db";
import { eq, and, sql as drizzleSql } from "drizzle-orm";

export async function markDormantEntities(runDate: string): Promise<void> {
  const threshold = new Date(Date.now() - 14 * 86400_000).toISOString().split("T")[0];

  const result = await db
    .update(entities)
    .set({ status: "dormant" })
    // NULL-tolerant on purpose: `last_mentioned < date` is never TRUE for a NULL, so a row
    // inserted without one used to be permanently unreachable by every cleanup path.
    .where(and(eq(entities.status, "active"), drizzleSql`(last_mentioned IS NULL OR last_mentioned < ${threshold})`))
    .returning({ id: entities.id });

  // Reactivate any dormant entity mentioned in today's run
  await db
    .update(entities)
    .set({ status: "active" })
    .where(and(eq(entities.status, "dormant"), eq(entities.lastMentioned, runDate)));

  if (result.length > 0) {
    console.log(`[Phase 6] Marked ${result.length} entity(ies) as dormant (absent > 14 days)`);
  }
}
