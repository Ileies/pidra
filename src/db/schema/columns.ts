import { customType, date, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
// Not `jsonb` from pg-core: that one double-encodes on the Bun SQL driver. Same signature. See src/db/jsonb.ts.
export { jsonb } from "../jsonb";

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
export const dateStr = (name: string) => date(name, { mode: "string" });

export const pk = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
export const createdAt = () => timestamptz("created_at").default(sql`now()`);
export const updatedAt = () => timestamptz("updated_at").default(sql`now()`);

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
