import { drizzle } from "drizzle-orm/bun-sql";
import { eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import * as relations from "./relations";

// The Drizzle client (Bun SQL driver) and the re-exported schema (src/db/schema/*, source of truth
// for tables; see docs/schema-notes.md). Throws at import when DATABASE_URL is unset.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const db = drizzle({ connection: connectionString, schema: { ...schema, ...relations } });

export * from "./schema";

export async function rawItemExists(messageId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.rawItems.id }).from(schema.rawItems).where(eq(schema.rawItems.messageId, messageId)).limit(1);
  return !!row;
}

/** Which of `messageIds` already have a `raw_items` row: one query instead of one per id. */
export async function existingMessageIds(messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await db.select({ messageId: schema.rawItems.messageId }).from(schema.rawItems).where(inArray(schema.rawItems.messageId, messageIds));
  return new Set(rows.map((r) => r.messageId!));
}
