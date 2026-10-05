/**
 * A throwaway local Postgres for `tests-db/`: initdb in a temp dir, fsync off, schema loaded into a
 * template database `tpl` that every test file clones. Used by `scripts/check-db-tests.ts` (the
 * `db tests` check step) and by `tests-db/fixtures/database.ts`, which shares `assertThrowawayUrl`.
 * Never touches any database that is not the one started here; see TEST_PLAN.md Phase 4.
 */
import { $, SQL } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export const TEMPLATE = "tpl";
const ROOT = join(import.meta.dir, "..", "..");
const DIR_PREFIX = "pidra-pgtest.";

export interface TestPostgres {
  /** Superuser URL on the `postgres` database; clones are made from here. */
  adminUrl: string;
  stop(): Promise<void>;
}

/**
 * The hard rule: a URL is acceptable only when it points at this machine (loopback or a unix
 * socket) and, when it names a database, that name is a throwaway one (`t_*`, `*_test`, or the
 * maintenance database `postgres` that clones are created from).
 */
export function assertThrowawayUrl(raw: string): void {
  const url = new URL(raw);
  const local = ["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(url.hostname);
  const database = decodeURIComponent(url.pathname.slice(1));
  const throwaway = database === "postgres" || database === TEMPLATE || database.startsWith("t_") || database.endsWith("_test");
  if (!local || !throwaway) throw new Error(`refusing to use ${url.hostname || "(socket)"}/${database}: tests only run against the local throwaway Postgres`);
}

/** Directory holding `initdb`, `pg_ctl`: PATH first, then nixpkgs. Never a silent skip. */
async function binDir(): Promise<string> {
  const onPath = Bun.which("initdb");
  if (onPath) return dirname(onPath);
  const built = await $`nix build --no-link --print-out-paths nixpkgs#postgresql_17`.quiet().nothrow();
  for (const out of built.stdout.toString().split("\n")) {
    if (out && existsSync(join(out, "bin", "initdb"))) return join(out, "bin");
  }
  throw new Error("no Postgres binaries found: put initdb/pg_ctl on PATH or install nix (`nix shell nixpkgs#postgresql_17`)");
}

async function freePort(): Promise<number> {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Removes what a killed earlier run left behind: dead ones at once, live ones after 30 minutes. */
function sweepStale(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(DIR_PREFIX)) continue;
    const dir = join(tmpdir(), name);
    try {
      const pid = Number.parseInt(readFileSync(join(dir, "data", "postmaster.pid"), "utf8"), 10);
      if (alive(pid)) {
        if (Date.now() - statSync(dir).mtimeMs < 30 * 60_000) continue;
        process.kill(pid, "SIGQUIT");
      }
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

async function exportDdl(): Promise<string> {
  const out = await $`bun x drizzle-kit export --dialect postgresql --schema src/db/schema/index.ts --sql`.cwd(ROOT).quiet();
  return out.stdout.toString();
}

export async function startTestPostgres(): Promise<TestPostgres> {
  sweepStale();
  const bin = await binDir();
  const dir = mkdtempSync(join(tmpdir(), DIR_PREFIX));
  // Unix sockets allow ~107 bytes, so the socket directory stays short.
  const sockets = mkdtempSync("/tmp/pgs.");
  const data = join(dir, "data");
  const port = await freePort();
  let started = false;

  const stop = async () => {
    if (started) await $`${join(bin, "pg_ctl")} -D ${data} -m immediate -w stop`.quiet().nothrow();
    rmSync(dir, { recursive: true, force: true });
    rmSync(sockets, { recursive: true, force: true });
  };

  try {
    await $`${join(bin, "initdb")} -D ${data} -U test --auth=trust --no-sync --no-locale -E UTF8`.quiet();
    const options = `-p ${port} -k ${sockets} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c shared_buffers=32MB -c max_connections=50`;
    await $`${join(bin, "pg_ctl")} -D ${data} -l ${join(dir, "log")} -w -o ${options} start`.quiet();
    started = true;

    const adminUrl = `postgres://test@127.0.0.1:${port}/postgres`;
    const admin = new SQL(adminUrl);
    await admin.unsafe(`create database ${TEMPLATE}`);
    await admin.close();
    const template = new SQL(`postgres://test@127.0.0.1:${port}/${TEMPLATE}`);
    await template.unsafe(await exportDdl());
    await template.close();
    return { adminUrl, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
