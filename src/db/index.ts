import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import * as relations from "./relations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const db = drizzle({ connection: connectionString, schema: { ...schema, ...relations } });

export * from "./schema";

export async function rawItemExists(messageId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.rawItems.id }).from(schema.rawItems).where(eq(schema.rawItems.messageId, messageId)).limit(1);
  return !!row;
}
