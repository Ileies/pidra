import { customType } from "drizzle-orm/pg-core";

/**
 * `jsonb` for the Bun SQL driver. Drop-in replacement for the one in `drizzle-orm/pg-core`,
 * which double-encodes on this driver.
 *
 * Drizzle's built-in type calls `JSON.stringify` in its `toDriver` (correct for node-postgres,
 * which passes parameters through as text). Bun's driver then serialises that string a second
 * time, so the column ends up holding a JSON *string* scalar: `jsonb_typeof` returns `string`
 * and `->`, `@>`, `jsonb_array_length` and GIN indexing all misbehave. Drizzle's reads are
 * symmetric and parse it back, which is why the pipeline never noticed and only raw SQL did.
 *
 * Measured on this driver, inserting `{a: 1, list: [1,2,3]}`:
 *   raw object       -> jsonb_typeof = object   (correct)
 *   JSON.stringify'd -> jsonb_typeof = string   (the bug)
 *
 * So `toDriver` hands the value over untouched and lets the driver serialise it exactly once.
 *
 * `fromDriver` still accepts a string: rows written before the 2026-09-10 conversion, and any
 * that a stray raw-SQL writer produces, keep reading correctly. No column in this schema stores
 * a bare JSON string scalar as its real value, so the parse is never ambiguous.
 */
export const jsonb = <TData = unknown>(name: string) =>
  customType<{ data: TData; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value: TData) => value as unknown,
    fromDriver: (value: unknown) =>
      (typeof value === "string" ? JSON.parse(value) : value) as TData,
  })(name);
