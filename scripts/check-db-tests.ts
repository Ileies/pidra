#!/usr/bin/env bun
/**
 * The `db tests` check step (`bun run test:db` runs it alone): starts a throwaway Postgres, runs
 * every `tests-db/**.test.ts` against it and tears it down, also on SIGINT. Each file gets its own
 * `bun test` process, because `src/db` reads `DATABASE_URL` once at import and a shared process
 * would keep every later file on the first file's database (and share `mock.module` overrides).
 * Arguments: `.test.ts` paths select files, anything else is passed on to `bun test` (`-t` filter).
 */
import { Glob } from "bun";
import { startTestPostgres } from "./lib/test-postgres";

const args = process.argv.slice(2);
const selected = args.filter((a) => a.endsWith(".test.ts"));
const passthrough = args.filter((a) => !a.endsWith(".test.ts"));
const files = selected.length > 0 ? selected : [...new Glob("tests-db/**/*.test.ts").scanSync(".")].sort();
if (files.length === 0) {
  console.error("db tests: no test files found under tests-db/");
  process.exit(1);
}

const pg = await startTestPostgres();
let code = 1;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void pg.stop().finally(() => process.exit(130)));
}

try {
  // DATABASE_URL is set to the local maintenance database too, so a module that imports `src/db`
  // before `useTestDatabase()` runs can only ever reach this instance, never the `.env` one.
  const env = { ...process.env, PIDRA_TEST_DATABASE_URL: pg.adminUrl, DATABASE_URL: pg.adminUrl };
  const runs = await Promise.all(
    files.map(async (file) => {
      const proc = Bun.spawn([process.execPath, "test", `./${file.replace(/^\.\//, "")}`, ...passthrough], { env, stdout: "pipe", stderr: "pipe" });
      const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      return { file, exit, text: `${out}${err}`.trimEnd() };
    }),
  );

  const count = (re: RegExp) => runs.reduce((sum, r) => sum + Number(r.text.match(re)?.[1] ?? 0), 0);
  for (const run of runs.filter((r) => r.exit !== 0)) console.error(`\n=== ${run.file} ===\n${run.text}`);
  code = runs.some((r) => r.exit !== 0) ? 1 : 0;
  console.log(`db tests: ${count(/^\s*(\d+) pass/m)} pass, ${count(/^\s*(\d+) fail/m)} fail across ${files.length} files`);
} finally {
  await pg.stop();
}
process.exit(code);
