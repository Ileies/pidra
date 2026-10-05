#!/usr/bin/env bun
/**
 * The `db tests` check step (`bun run test:db` runs it alone): starts a throwaway Postgres, runs
 * `bun test ./tests-db` against it and tears it down, also on SIGINT. Extra arguments go to
 * `bun test` (a file or `-t` filter).
 */
import { startTestPostgres } from "./lib/test-postgres";

const pg = await startTestPostgres();
let code = 1;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void pg.stop().finally(() => process.exit(130)));
}

try {
  // DATABASE_URL is set to the local maintenance database too, so a module that imports `src/db`
  // before `useTestDatabase()` runs can only ever reach this instance, never the `.env` one.
  const proc = Bun.spawn([process.execPath, "test", "./tests-db", ...process.argv.slice(2)], {
    env: { ...process.env, PIDRA_TEST_DATABASE_URL: pg.adminUrl, DATABASE_URL: pg.adminUrl },
    stdout: "inherit",
    stderr: "inherit",
  });
  code = await proc.exited;
} finally {
  await pg.stop();
}
process.exit(code);
