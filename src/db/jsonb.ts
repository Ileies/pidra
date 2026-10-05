import { customType } from "drizzle-orm/pg-core";

/**
 * `jsonb` for the Bun SQL driver: use this, never `jsonb` from `drizzle-orm/pg-core`, which
 * double-encodes here (drizzle's `JSON.stringify` plus Bun's own serialisation stores a JSON *string*
 * scalar, breaking `->`, `@>` and `jsonb_typeof` in raw SQL). `toDriver` hands the value over
 * untouched. `fromDriver` still parses strings so rows from before the 2026-09-10 conversion read
 * correctly (no column stores a bare string scalar as its real value, so this is unambiguous).
 */
export const jsonb = <TData = unknown>(name: string) =>
  customType<{ data: TData; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value: TData) => value as unknown,
    fromDriver: (value: unknown) =>
      (typeof value === "string" ? JSON.parse(value) : value) as TData,
  })(name);
