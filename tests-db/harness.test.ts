// Proves the throwaway database itself: the clone has every schema table, clones are isolated, and
// a CHECK constraint from the schema really rejects a bad row.
import { describe, expect, test } from "bun:test";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/db/schema";
import { assertThrowawayUrl } from "../scripts/lib/test-postgres";
import { useTestDatabase } from "./fixtures/database";

const one = await useTestDatabase();
const two = await useTestDatabase();

describe("throwaway database", () => {
  test("a clone has every table the schema declares", async () => {
    const declared = Object.values(schema).filter((v) => is(v, PgTable)).map((t) => getTableName(t as PgTable)).sort();
    const rows = await one.sql`select table_name from information_schema.tables where table_schema = 'public'`;
    expect(rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(declared);
    expect(declared.length).toBeGreaterThan(30);
  });

  test("clones do not see each other's rows", async () => {
    await one.sql`insert into brave_daily_usage (day, calls) values ('2026-01-01', 3)`;
    const [mine] = await one.sql`select count(*)::int as n from brave_daily_usage`;
    const [theirs] = await two.sql`select count(*)::int as n from brave_daily_usage`;
    expect([mine.n, theirs.n]).toEqual([1, 0]);
  });

  test("a schema CHECK constraint rejects a bad row", async () => {
    // A Bun SQL query is a lazy thenable, not a Promise: `rejects` hangs on it unless it is awaited inside a real one.
    const bad = (async () => {
      await two.sql`insert into brave_daily_usage (day, calls) values ('2026-01-02', 31)`;
    })();
    await expect(bad).rejects.toThrow(/brave_daily_usage_calls_range/);
  });
});

describe("assertThrowawayUrl", () => {
  test("accepts the local throwaway shapes", () => {
    for (const ok of ["postgres://test@127.0.0.1:5432/postgres", "postgres://test@localhost/t_abc", "postgres://u@127.0.0.1/pidra_test"]) {
      expect(() => assertThrowawayUrl(ok)).not.toThrow();
    }
  });

  test("refuses a remote host or a real database name", () => {
    for (const bad of ["postgres://u@192.168.10.85:5432/pidra", "postgres://u@127.0.0.1/pidra", "postgres://u@db.example.com/t_abc"]) {
      expect(() => assertThrowawayUrl(bad)).toThrow(/refusing/);
    }
  });
});
