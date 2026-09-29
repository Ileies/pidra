import { db, rawItems, contacts } from "../../db";
import { and, eq, sql } from "drizzle-orm";

// `contacts.identifier` and `raw_items.source_name` (for source_type = 'personal_email') use the
// same lowercase-address convention (imap.ts, context-builder/pipeline/batch-contacts.ts), so this
// is a plain join key. Only updates rows that already exist - creating a contact stays exclusive
// to the SYSTEM block's `new_contacts` suggestions, so this never turns every sender into a contact.
export async function incrementContactEmailCounts(runDate: string): Promise<void> {
  const rows = await db
    .select({ sourceName: rawItems.sourceName, count: sql<number>`count(*)::int` })
    .from(rawItems)
    .where(and(eq(rawItems.runDate, runDate), eq(rawItems.sourceType, "personal_email")))
    .groupBy(rawItems.sourceName);

  for (const row of rows) {
    if (!row.sourceName) continue;
    await db.update(contacts)
      .set({ emailCount: sql`${contacts.emailCount} + ${row.count}`, updatedAt: sql`now()` })
      .where(eq(contacts.identifier, row.sourceName));
  }
}
