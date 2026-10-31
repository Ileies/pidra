#!/usr/bin/env bun
/**
 * Deploys this working tree to pronix by building the dashboard here and rsyncing the result.
 *
 * The server holds no git checkout, no source tree, no `node_modules` and no toolchain beyond Bun:
 * it receives the built dashboard (`dashboard/build/`, which lands as `dashboard/` there), the
 * bundled bridge, jobs and tools (`build/server/`, which lands flat in the app root). Every
 * dependency is bundled in, so there is no install step.
 * Order: local preflight, check, build, hand state to pidra, sync, restart, verify.
 * Procedure and server layout: docs/operations.md.
 *
 * Usage:
 *   bun run deploy                 preflight, check, build, sync, restart, verify
 *   bun run deploy --dry-run       print every step without touching the server or building
 *   bun run deploy --skip-check    skip `bun run check` entirely (for a deploy that only syncs files)
 *   bun run deploy --quick-check   run `bun run check --quick` instead of the full check (skips
 *                                  `blackhole/run.ts`) - for a small change you're confident can't
 *                                  touch routing, offline behavior or rendering. Prefer the full
 *                                  check by default; this trades coverage for speed
 *   bun run deploy --force         deploy with an uncommitted working tree. The uncommitted edits
 *                                  DO go to the server (rsync sends the tree, not a commit), but
 *                                  `.deployed-rev` then names a commit that does not match them
 *   bun run deploy --host <alias>  deploy somewhere other than `ros`
 */
import { $ } from "bun";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const HOST = value("host", "ros");
const REMOTE_ROOT = value("remote-root", "/var/www/pidra");
const DRY = flag("dry-run");

/**
 * The long-lived units. The oneshot jobs behind the timers (`pidra-pipeline` and friends) are
 * deliberately absent: each one starts a fresh process from the new code at its next firing, and
 * restarting one here would run a briefing at deploy time.
 */
const SERVICES = ["pidra-bridge", "pidra-dashboard"];

/**
 * No gitignored file is synced. `.env` must never be: the two files carry the same keys with
 * different values (the server talks to Postgres locally, the workstation through a forward), so
 * copying either direction breaks the other machine. Same reasoning for the Context Builder's state
 * files (`.checkpoint.json`, `errors.json`): they are live run state of the server's own monthly
 * run, not a newer version of the workstation's. The harvest itself lives in Postgres.
 */

/** The unit's DATA_DIR on pronix (pidra.nix). Everything the services write lives under it. */
const REMOTE_DATA = "/var/lib/pidra";

/**
 * The server bundles (bridge, job runner and Keep auth, from scripts/build-server.ts)
 * land directly in `REMOTE_ROOT`, next to `.env` and `dashboard/`. No TypeScript source and no
 * `node_modules` go over.
 *
 * The root also holds files the deploy does not own, so the mirror is limited to `*.js` and
 * `*.js.map` by a filter: --delete removes only what the filter admits, and the `*` exclude both
 * stops rsync descending into `dashboard/` and protects everything else from deletion.
 */
const SERVER_LOCAL = "build/server/";
const SERVER_FILTERS = ["--include=*.js", "--include=*.js.map", "--exclude=*"];

/**
 * The dashboard build lands as the server's `dashboard/` directory itself (the unit runs
 * `dashboard/index.js`), so unlike the server bundles it is mirrored with no filter. --delete empties
 * everything else in there, including the `node_modules` and `build/` of the old layout.
 */
const DASHBOARD_LOCAL = "dashboard/build/";
const DASHBOARD_REMOTE = `${REMOTE_ROOT}/dashboard/`;

/** Names the commit the server's code was built from. Written only after the sync succeeded. */
const REV_FILE = `${REMOTE_ROOT}/.deployed-rev`;

let failed = false;

function step(title: string) {
  console.log(`\n\x1b[1m▸ ${title}\x1b[0m`);
}

/** Prints a verification line with a tick or a cross, marks the deploy unhealthy on a cross, and returns `ok`. */
function report(ok: boolean, text: string): boolean {
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${text}`);
  if (!ok) failed = true;
  return ok;
}

function fail(message: string): never {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

/** Everything a failed shell command printed (stdout and stderr, which `.quiet()` captured) plus its exit code. */
function describeError(err: unknown): string {
  if (err instanceof $.ShellError) {
    const output = [err.stdout.toString(), err.stderr.toString()].map((s) => s.trim()).filter(Boolean).join("\n");
    return `${output ? `${output}\n` : ""}(exit code ${err.exitCode})`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Awaits a shell command and, if it fails, prints its captured output and aborts the deploy. */
async function must<T>(what: string, command: PromiseLike<T>): Promise<T> {
  try {
    return await command;
  } catch (err) {
    fail(`${what} failed:\n${describeError(err)}`);
  }
}

// ControlMaster multiplexes the ~10 `remote()` calls over one SSH connection (opened below), so
// the script does not depend on the workstation's `~/.ssh/config`.
const SSH_CONTROL_PATH = `${process.env.TMPDIR ?? "/tmp"}/pidra-deploy-${HOST}.sock`;
const SSH_OPTS = ["-o", "ConnectTimeout=10", "-o", "ControlMaster=auto", "-o", `ControlPath=${SSH_CONTROL_PATH}`, "-o", "ControlPersist=60s"];

/** Runs a command on the server. Quoted as one argv entry, so the remote shell sees it verbatim. */
async function remote(script: string): Promise<string> {
  if (DRY) {
    console.log(`  [dry-run] ssh ${HOST}: ${script}`);
    return "";
  }
  const out = await must(`ssh ${HOST}: ${script}`, $`ssh ${SSH_OPTS} ${HOST} ${script}`.quiet());
  return out.text().trim();
}

if (!DRY) {
  // Open the master up front so concurrent calls later reuse it instead of racing to become it.
  await must(`opening the SSH connection to ${HOST}`, $`ssh ${SSH_OPTS} -MNf ${HOST}`.quiet());
}

step("Preflight (local)");

const dirty = (await $`git status --porcelain`.text()).trim();
if (dirty) {
  console.error(dirty);
  if (!flag("force")) {
    fail("working tree has uncommitted changes - rsync sends the tree as it is, so the server would run code no commit describes");
  }
  console.log("  --force: deploying the working tree anyway - the changes above WILL be on the server");
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
const head = (await $`git rev-parse HEAD`.text()).trim();
console.log(`  ${branch} @ ${head.slice(0, 8)}${dirty ? " (+ uncommitted changes)" : ""}`);

step(`Local check + preflight (${HOST})`);

const quickCheck = flag("quick-check");

const localCheckFailure = flag("skip-check")
  ? Promise.resolve(null as string | null)
  : (async (): Promise<string | null> => {
      if (DRY) {
        console.log(`  [dry-run] bun run check${quickCheck ? " --quick" : ""} (root + dashboard)`);
        return null;
      }
      // Root `check` already runs the dashboard's check (blackhole included); don't call it twice.
      const checkArgs = quickCheck ? ["--quick"] : [];
      return $`bun run check ${checkArgs}`
        .quiet()
        .then(() => null)
        .catch((err) => `\`bun run check\` failed - not deploying\n${describeError(err)}`);
    })();

// `.env` is the marker of a provisioned root: rsync would happily create a fresh tree on the wrong
// host or path, and the units would then fail on their missing EnvironmentFile.
const remoteRootFailure = (async (): Promise<string | null> => {
  if (DRY) return null;
  const hasEnv = await remote(`test -f ${REMOTE_ROOT}/.env && echo yes || echo no`);
  return hasEnv === "yes" ? null : `${HOST}:${REMOTE_ROOT}/.env does not exist - wrong host or --remote-root, or the server is not provisioned`;
})();

const [localFailure, remoteFailure] = await Promise.all([localCheckFailure, remoteRootFailure]);
for (const failure of [localFailure, remoteFailure]) {
  if (failure) console.error(`\n\x1b[31m✗ ${failure}\x1b[0m`);
}
if (localFailure || remoteFailure) process.exit(1);

if (!DRY) {
  if (!flag("skip-check")) {
    console.log(quickCheck ? "  root and dashboard both pass (quick - blackhole was skipped)" : "  root and dashboard both pass");
  }
  console.log(`  ${REMOTE_ROOT} is provisioned`);
}

step("Building the dashboard and the server bundles");
if (DRY) console.log("  [dry-run] cd dashboard && bun run build; bun run build:server");
else {
  await must("the dashboard build", $`bun run build`.cwd("dashboard").quiet());
  console.log("  dashboard/build/ built");
  await must("the server bundle build", $`bun run build:server`.quiet());
  console.log("  build/server/ built (bridge, job runner, Keep auth; deployed flat into the app root)");
}

// The services write under REMOTE_DATA as the `pidra` user, and keep-auth.js writes as root. So the
// directories are created and owned by pidra first. Missing state files are created empty:
// errors.ts tolerates an empty file and the checkpoint is write-only.
step("Handing the Context Builder's state to pidra");
// One command per call, no loops: the server's login shell is fish, whose syntax differs from sh.
const CB = `${REMOTE_DATA}/context-builder`;
await remote(`install -d -m 0750 -o pidra -g pidra ${REMOTE_DATA}`);
await remote(`install -d -m 0750 -o pidra -g pidra ${CB}`);
for (const name of [".checkpoint.json", "errors.json", ".dashboard-run.log"]) {
  await remote(`test -e ${CB}/${name} || install -m 0640 -o pidra -g pidra /dev/null ${CB}/${name}`);
  await remote(`chown pidra:pidra ${CB}/${name}`);
}
if ((await remote(`test -e ${CB}/.keep-token.json && echo yes || echo no`)) === "yes") {
  await remote(`chown pidra:pidra ${CB}/.keep-token.json && chmod 0600 ${CB}/.keep-token.json`);
}
if (!DRY) console.log("  state directories and files owned by pidra");

step(`Syncing code and the built dashboard to ${HOST}:${REMOTE_ROOT}`);
// No -o/-g: the server side runs as root, so the code stays root-owned and read-only to the pidra
// user, as the units expect.
async function syncCode(label: string, source: string[], dest: string, extra: string[]) {
  const args = ["-rlptz", "--delete", "--itemize-changes", ...(DRY ? ["--dry-run"] : []), ...extra, ...source, `${HOST}:${dest}`];
  const changes = (await must(`rsync of ${label}`, $`rsync ${args}`.quiet())).text().trim();
  const lines = changes ? changes.split("\n").filter((l) => !l.startsWith("cd") && !l.endsWith("/")) : [];
  console.log(`  ${DRY ? "[dry-run] " : ""}${label}: ${lines.length} change(s)`);
  for (const line of lines.slice(0, 12)) console.log(`    ${line}`);
  if (lines.length > 12) console.log(`    ... and ${lines.length - 12} more`);
}
await syncCode("server bundles", [SERVER_LOCAL], `${REMOTE_ROOT}/`, SERVER_FILTERS);
await syncCode("dashboard", [DASHBOARD_LOCAL], DASHBOARD_REMOTE, []);

await remote(`echo ${head} > ${REV_FILE}`);

step(`Restarting ${SERVICES.join(" ")}`);
await remote(`systemctl restart ${SERVICES.join(" ")}`);

step("Verifying");

const deployedRev = await remote(`cat ${REV_FILE}`);
if (!DRY) report(deployedRev === head, `${REV_FILE} names ${deployedRev.slice(0, 8) || "nothing"}, expected ${head.slice(0, 8)}`);

const serviceStates = await Promise.all(
  SERVICES.map(async (service) => ({ service, state: await remote(`systemctl is-active ${service} || true`) })),
);
for (const { service, state } of serviceStates) {
  if (DRY) continue;
  if (!report(state === "active", `${service}: ${state}`)) {
    console.error(await remote(`journalctl -u ${service} -n 15 --no-pager`));
  }
}

// HTTP checks cover the build (systemd says `active` even for a broken page). Redirects are
// followed because `/` is a 307 to today's report, so a bare status check would pass with nothing
// rendered.
const port = (await remote(`systemctl show pidra-dashboard -p Environment --value | tr ' ' '\\n' | grep '^PORT=' | cut -d= -f2`)) || "3009";
const verifyResults = await Promise.all(
  ["/", "/context-builder"].map(async (path) => ({
    path,
    code: await remote(`curl -fsSL -o /dev/null -w '%{http_code}' --max-time 30 http://localhost:${port}${path} || true`),
  })),
);
for (const { path, code } of verifyResults) {
  if (!DRY) report(code === "200", `${path} on :${port} answered ${code || "nothing"}`);
}

// The long-term document the briefing synthesises on. A missing or unusable one degrades every
// briefing without failing anything, so the deploy checks it in Postgres, from here: the `document`
// column is the only place the harvest lives. Mirrors `loadLongTermContext`: the newest of the last
// CANDIDATE_RUNS completed runs whose document has `# 1.` to `# 5.` sections wins, and an update
// patch above it is legitimate. No such run fails the deploy.
const CANDIDATE_RUNS = 5;
step("Long-term context (database)");
if (DRY) console.log("  [dry-run] query context_builder_runs through the SSH forward");
else {
  const dbUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (!dbUrl) report(false, "DATABASE_URL is not set, so the long-term context could not be checked");
  else {
    // The workstation's DATABASE_URL points at a local forward (docs/operations.md). Open it on the
    // deploy's own SSH connection unless one is already up, and close it again afterwards.
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname);
    const forward = `${dbUrl.port || 5432}:127.0.0.1:5432`;
    const forwarded = loopback && (await $`ssh ${SSH_OPTS} -O forward -L ${forward} ${HOST}`.quiet().nothrow()).exitCode === 0;
    try {
      const { SQL } = await import("bun");
      const sql = new SQL(dbUrl.href);
      const runs = await sql`
        select started_at,
               document is not null as has_document,
               coalesce(document->>'fullContext' ~ '(^|\n)# [1-5]\.', false) as has_sections
        from context_builder_runs where status = 'completed'
        order by started_at desc limit ${CANDIDATE_RUNS}`;
      await sql.close();
      const winner = runs.findIndex((r: { has_sections: boolean }) => r.has_sections);
      if (runs.length === 0) report(false, "no completed Context Builder run");
      else if (winner < 0) report(false, `none of the last ${runs.length} completed runs has a document with # 1. to # 5. sections`);
      else {
        const day = new Date(runs[winner].started_at).toISOString().slice(0, 10);
        console.log(`  \x1b[32m✓\x1b[0m long-term context: the run of ${day}${winner > 0 ? ` (newer runs skipped: ${winner}, patches or runs without a document)` : ""}`);
      }
    } catch (err) {
      report(false, `could not query the long-term context: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (forwarded) await $`ssh ${SSH_OPTS} -O cancel -L ${forward} ${HOST}`.quiet().nothrow();
    }
  }
}

if (!DRY) {
  // Close the master now instead of waiting out ControlPersist.
  await $`ssh ${SSH_OPTS} -O exit ${HOST}`.quiet().catch(() => {});
}

console.log(
  failed
    ? "\n\x1b[31m✗ Deployed, but something is not healthy - see above.\x1b[0m"
    : `\n\x1b[32m✓ ${HOST} is on ${head.slice(0, 8)}.\x1b[0m`,
);
process.exit(failed ? 1 : 0);
