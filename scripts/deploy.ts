#!/usr/bin/env bun
/**
 * Deploys the working tree's committed state to pronix.
 *
 * The server runs from a clone of the public GitHub repo, so a deploy is a reset to this HEAD there
 * plus what a pull cannot carry: gitignored harvest files (SYNC), the dependency install and the
 * dashboard build. Order: local preflight, check, pull, sync, install+build, restart, verify.
 * Procedure and server layout: docs/operations.md.
 *
 * Usage:
 *   bun run deploy                 preflight, sync, build, restart, verify
 *   bun run deploy --push          push the current branch first, instead of refusing
 *   bun run deploy --dry-run       print every step without touching the server
 *   bun run deploy --skip-check    skip `bun run check` entirely (for a deploy that only syncs files)
 *   bun run deploy --quick-check   run `bun run check --quick` instead of the full check (skips
 *                                  `blackhole/run.ts`) - for a small change you're confident can't
 *                                  touch routing, offline behavior or rendering. Prefer the full
 *                                  check by default; this trades coverage for speed
 *   bun run deploy --force         deploy with an uncommitted working tree. Still deploys the last
 *                                  *commit*, never the uncommitted edits themselves - use this to
 *                                  acknowledge that gap, not to ship uncommitted work
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
 * direction breaks the other machine. Same reasoning excludes `context-builder/.checkpoint.json`
 * and `errors.json` - those are live run state, and the server runs its own Context Builder on the
 * monthly timer, so the workstation's copies are not a newer version of them but a different
 * machine's.
 */
const SYNC: { path: string; filters?: string[] }[] = [
  // Only the harvested documents. `builder.ts` and `db-writer.ts` sit in the same directory and
  // are tracked, so they arrive with the pull - rsync has no business touching them.
  { path: "context-builder/output/", filters: ["--include=*.json", "--include=*.md", "--exclude=*"] },
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
    fail("working tree has uncommitted changes - the server deploys a commit, so it would get something else");
  }
  console.log("  --force: deploying HEAD anyway - the uncommitted changes above will NOT be on the server");
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
const head = (await $`git rev-parse HEAD`.text()).trim();
console.log(`  ${branch} @ ${head.slice(0, 8)}`);

await $`git fetch --quiet origin ${branch}`;
const ahead = (await $`git rev-list --count origin/${branch}..${branch}`.text()).trim();
const behind = (await $`git rev-list --count ${branch}..origin/${branch}`.text()).trim();

// Behind means someone else pushed, and the server is reset to this HEAD - so deploying would
// roll their work off it. Ahead of a `behind` is a diverged branch, which is worse: --push would
// be rejected anyway, and forcing it past that is not a thing a deploy script should offer.
if (behind !== "0") {
  fail(
    `${behind} commit(s) on origin/${branch} are not in the local branch, so deploying would move ` +
      `${HOST} backwards past them. Pull or rebase first.`,
  );
}

if (ahead !== "0") {
  if (!flag("push")) {
    fail(
      `${ahead} commit(s) not on origin. The server pulls from a public GitHub repo, so deploying ` +
        `publishes them - rerun with --push once you mean to, or push yourself.`,
    );
  }
  step(`Pushing ${ahead} commit(s) to origin/${branch}`);
  if (DRY) console.log(`  [dry-run] git push origin ${branch}`);
  else await $`git push origin ${branch}`;
}

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

const remoteDirtyFailure = (async (): Promise<string | null> => {
  const remoteDirty = await remote(`cd ${REMOTE_ROOT} && git status --porcelain`);
  if (!remoteDirty) return null;
  console.error(remoteDirty);
  return `${HOST}:${REMOTE_ROOT} has local modifications - a pull would conflict. Resolve them there first.`;
})();

const [localFailure, remoteFailure] = await Promise.all([localCheckFailure, remoteDirtyFailure]);
for (const failure of [localFailure, remoteFailure]) {
  if (failure) console.error(`\n\x1b[31m✗ ${failure}\x1b[0m`);
}
if (localFailure || remoteFailure) process.exit(1);

if (!DRY) {
  if (!flag("skip-check")) {
    console.log(quickCheck ? "  root and dashboard both pass (quick - blackhole was skipped)" : "  root and dashboard both pass");
  }
  console.log(`  ${REMOTE_ROOT} is clean`);
}

step(`Pulling ${branch} on ${HOST}`);
await remote(`cd ${REMOTE_ROOT} && git fetch --quiet origin ${branch} && git checkout --quiet ${branch} && git reset --hard --quiet ${head}`);
const remoteHead = await remote(`cd ${REMOTE_ROOT} && git rev-parse HEAD`);
if (!DRY && remoteHead !== head) fail(`${HOST} is at ${remoteHead.slice(0, 8)}, expected ${head.slice(0, 8)}`);
if (!DRY) console.log(`  now at ${head.slice(0, 8)}`);

step("Syncing gitignored files");
for (const { path, filters = [] } of SYNC) {
  // `-rlptz`, not `-a`: keep times and modes, not the workstation's ownership (server files are root-owned).
  const args = ["-rlptz", "--itemize-changes", ...(DRY ? ["--dry-run"] : []), ...filters, path, `${HOST}:${REMOTE_ROOT}/${path}`];
  const changes = (await $`rsync ${args}`.text()).trim();
  const label = DRY ? `[dry-run] ${path}` : path;
  console.log(changes ? `  ${label}:\n${changes.split("\n").map((l) => `    ${l}`).join("\n")}` : `  ${label}: already current`);
}

step("Installing dependencies and building the dashboard");
// One Bun workspace: the root install covers the dashboard too, and the build needs it first.
await remote(`cd ${REMOTE_ROOT} && bun install --frozen-lockfile && cd dashboard && bun run build`);
if (!DRY) console.log("  built");

step(`Restarting ${SERVICES.join(" ")}`);
await remote(`systemctl restart ${SERVICES.join(" ")}`);

step("Verifying");

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
const context = await remote(
  `cd ${REMOTE_ROOT} && bun -e 'const {loadLongTermContext}=await import("./src/pipeline/long-term-context");` +
    `const c=await loadLongTermContext();` +
    `console.log((c.intelSections.length+c.personalSections.length)+" chars, "+(c.problem??"ok"));` +
    `process.exit(0)'`,
);
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
