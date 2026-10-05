/**
 * `useTestDatabase()`: one cloned database per test file, from the template the `db tests` runner built.
 * Call it first in the file and `await import` anything that reaches `src/db` afterwards, because
 * that module reads `DATABASE_URL` once at import.
 */
import { afterAll } from "bun:test";
import { SQL } from "bun";
import { assertThrowawayUrl, TEMPLATE } from "../../scripts/lib/test-postgres";

export interface TestDatabase {
  name: string;
  url: string;
  sql: SQL;
}

export async function useTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.PIDRA_TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("PIDRA_TEST_DATABASE_URL is not set: run these tests with `bun run test:db`, not `bun test`");
  assertThrowawayUrl(adminUrl);

  const name = `t_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = new SQL(adminUrl);
  await admin.unsafe(`create database ${name} template ${TEMPLATE}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  assertThrowawayUrl(url.href);
  // Overwritten, never read: Bun loads `.env`, whose DATABASE_URL is the production database.
  process.env.DATABASE_URL = url.href;
  const sql = new SQL(url.href);

  afterAll(async () => {
    await sql.close();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  });
  return { name, url: url.href, sql };
}
