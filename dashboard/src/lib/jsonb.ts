/**
 * Normalises a `jsonb` value read over raw SQL.
 *
 * The pipeline writes jsonb through DrizzleORM on the Bun SQL driver. Drizzle's `jsonb` type
 * pre-stringifies its value (correct for node-postgres), and Bun's driver then serialises that
 * string a second time, so the column ends up holding a JSON *string* scalar rather than an
 * object or array. Drizzle's own reads are symmetric and parse it back, so the pipeline never
 * notices, but the dashboard reads over postgres.js and receives the raw string.
 *
 * Casting that string `as SomeType[]` type-checks and then fails at runtime in the worst
 * possible way: `{#each}` over a string iterates its characters, so a single pending gate
 * question rendered as "183 questions pending", 183 being the length of the JSON text.
 *
 * This accepts both shapes, so it keeps working unchanged if the storage is ever normalised
 * to real jsonb.
 */
export function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}
