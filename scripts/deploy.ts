#!/usr/bin/env bun
/**
 * Deploys this working tree to pronix by building the dashboard here and rsyncing the result.
 *
 * The server holds no git checkout, no source tree, no `node_modules` and no toolchain beyond Bun:
 * it receives the built dashboard (`dashboard/build/`, which lands as `dashboard/` there), the
 * bundled bridge and jobs (`build/server/`) and the Context Builder's Python (CODE_PATHS), plus the
 * gitignored harvest files (SYNC). Every dependency is bundled in, so there is no install step.
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
 * Gitignored paths the server needs a copy of.
 *
 * `.env` is *not* here and must never be: the two files carry the same keys with different values
 * (the server talks to Postgres locally, the workstation through a forward), so copying either
 * direction breaks the other machine. Same reasoning excludes the Context Builder's state files
 * (`.checkpoint.json`, `errors.json`): those are live run state, and the server runs its own Context
 * Builder on the monthly timer, so the workstation's copies are not a newer version of them but a
 * different machine's.
 */

/** The unit's DATA_DIR on pronix (pidra.nix). Everything the services write lives under it. */
const REMOTE_DATA = "/var/lib/pidra";

/**
 * What the server runs, relative to the repo root and to `REMOTE_ROOT`: `build/server/` (the
 * bridge, job runner and context probe, from scripts/build-server.ts) and `context-builder/scripts/`
 * (the Python the monthly harvest spawns, and `keep-auth.py`, run by hand), which no bundle can
 * carry. No TypeScript source and no `node_modules` go over.
 *
 * Each directory is mirrored with --delete, so a file removed here disappears there; paths not
 * listed are never touched, which is what keeps the Context Builder's `.venv` (built on the server)
 * alive.
 */
const CODE_PATHS = ["build/server/", "context-builder/scripts/"];
const CODE_EXCLUDES = ["--exclude=__pycache__/"];

/**
 * The dashboard build lands as the server's `dashboard/` directory itself (the unit runs
 * `dashboard/index.js`), so unlike CODE_PATHS it is mirrored under another name. --delete empties
 * everything else in there, including the `node_modules` and `build/` of the old layout.
 */
const DASHBOARD_LOCAL = "dashboard/build/";
const DASHBOARD_REMOTE = `${REMOTE_ROOT}/dashboard/`;

/** Names the commit the server's code was built from. Written only after the sync succeeded. */
const REV_FILE = `${REMOTE_ROOT}/.deployed-rev`;

const SYNC: { local: string; remote: string; filters?: string[] }[] = [
  // Only the harvested documents. The workstation keeps them under its own DATA_DIR (./data).
  {
    local: "data/context-builder/output/",
    remote: `${REMOTE_DATA}/context-builder/output/`,
    filters: ["--include=*.json", "--include=*.md", "--exclude=*"],
  },
];

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
  const out = await $`ssh ${SSH_OPTS} ${HOST} ${script}`.text();
  return out.trim();
}

if (!DRY) {
  // Open the master up front so concurrent calls later reuse it instead of racing to become it.
  await $`ssh ${SSH_OPTS} -MNf ${HOST}`.quiet();
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
        .catch(() => "`bun run check` failed - not deploying");
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
  await $`bun run build`.cwd("dashboard").quiet();
  console.log("  dashboard/build/ built");
  await $`bun run build:server`.quiet();
  console.log("  build/server/ built (bridge, job runner, context probe)");
}

// The services write under REMOTE_DATA as the `pidra` user, and the sync and keep-auth.py write as
// root. So the directories are created and owned by pidra first, and the sync hands its files over
// with --chown. Missing state files are created empty: errors.ts tolerates an empty file and the
// checkpoint is write-only. Runs before the sync, since rsync does not create the destination path.
step("Handing the Context Builder's state to pidra");
// One command per call, no loops: the server's login shell is fish, whose syntax differs from sh.
const CB = `${REMOTE_DATA}/context-builder`;
await remote(`install -d -m 0750 -o pidra -g pidra ${REMOTE_DATA}`);
await remote(`install -d -m 0750 -o pidra -g pidra ${CB}`);
await remote(`install -d -m 0750 -o pidra -g pidra ${CB}/output`);
for (const name of [".checkpoint.json", "errors.json", ".dashboard-run.log"]) {
  await remote(`test -e ${CB}/${name} || install -m 0640 -o pidra -g pidra /dev/null ${CB}/${name}`);
  await remote(`chown pidra:pidra ${CB}/${name}`);
}
if ((await remote(`test -e ${CB}/.keep-token.json && echo yes || echo no`)) === "yes") {
  await remote(`chown pidra:pidra ${CB}/.keep-token.json && chmod 0600 ${CB}/.keep-token.json`);
}
if (!DRY) console.log("  state directories and files owned by pidra");

step("Syncing gitignored files");
for (const { local, remote: dest, filters = [] } of SYNC) {
  // `-rlptz`, not `-a`: keep times and modes, not the workstation's ownership. --chown hands the
  // files to the pidra user, since the server side runs as root.
  const args = ["-rlptz", "--chown=pidra:pidra", "--itemize-changes", ...(DRY ? ["--dry-run"] : []), ...filters, local, `${HOST}:${dest}`];
  const changes = (await $`rsync ${args}`.text()).trim();
  const label = DRY ? `[dry-run] ${local}` : local;
  console.log(changes ? `  ${label}:\n${changes.split("\n").map((l) => `    ${l}`).join("\n")}` : `  ${label}: already current`);
}

step(`Syncing code and the built dashboard to ${HOST}:${REMOTE_ROOT}`);
// No -o/-g: the server side runs as root, so the code stays root-owned and read-only to the pidra
// user, as the units expect.
async function syncCode(label: string, source: string[], dest: string, extra: string[]) {
  const args = ["-rlptz", "--delete", "--itemize-changes", ...(DRY ? ["--dry-run"] : []), ...extra, ...source, `${HOST}:${dest}`];
  const changes = (await $`rsync ${args}`.text()).trim();
  const lines = changes ? changes.split("\n").filter((l) => !l.startsWith("cd") && !l.endsWith("/")) : [];
  console.log(`  ${DRY ? "[dry-run] " : ""}${label}: ${lines.length} change(s)`);
  for (const line of lines.slice(0, 12)) console.log(`    ${line}`);
  if (lines.length > 12) console.log(`    ... and ${lines.length - 12} more`);
}
// `--relative` keeps each path's directory under REMOTE_ROOT.
await syncCode("server bundles and Context Builder scripts", CODE_PATHS, `${REMOTE_ROOT}/`, ["--relative", ...CODE_EXCLUDES]);
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
// rendered. `/context-builder` is the one route that reads a file off disk, so it fails when the
// synced harvest is missing.
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

// The long-term document the briefing synthesises on. Legacy rows locate it by a path recorded by
// whichever machine built it, so a deploy can leave it behind; a missing one degrades every
// briefing without failing anything. Prints a warning, not a failure.
const context = await remote(`cd ${REMOTE_ROOT} && env DATA_DIR=${REMOTE_DATA} bun run build/server/verify-context.js`);
if (!DRY) {
  const ok = !context.includes("0 chars") && context.endsWith("ok");
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[33m!\x1b[0m"} long-term context: ${context}`);
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
