import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";
import * as relations from "./relations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

export const db = drizzle({ connection: connectionString, schema: { ...schema, ...relations } });

export * from "./schema";
