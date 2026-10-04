import { db, rawItems } from "../../db";
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

  const counted = rows.filter((row) => row.sourceName);
  if (counted.length === 0) return;

  await db.execute(sql`
    UPDATE contacts AS c SET email_count = c.email_count + v.count, updated_at = now()
    FROM (VALUES ${sql.join(counted.map((row) => sql`(${row.sourceName}::text, ${row.count}::integer)`), sql`, `)}) AS v(identifier, count)
    WHERE c.identifier = v.identifier
  `);
}
