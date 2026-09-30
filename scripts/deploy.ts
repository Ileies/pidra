#!/usr/bin/env bun
/**
 * Deploys the working tree's committed state to pronix.
 *
 * The server runs from a clone of the public GitHub repo, so a deploy is a `git pull` there plus
 * the three things a pull cannot carry: the gitignored config and harvest files, the dependency
 * install, and the dashboard build. Doing those by hand is how `dashboard/build/` ends up a
 * version behind the source it was built from, silently, since nothing about a stale build looks
 * broken.
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

function fail(message: string): never {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

// A deploy makes about ten `remote()` calls; without reuse each pays its own SSH handshake
// (~170-250ms measured). `ControlMaster` multiplexes them all over one connection, opened once
// below so it doesn't depend on the workstation's `~/.ssh/config`.
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
  // Opens the shared connection up front and waits for it, so the calls below that run
  // concurrently (install/build, the verify loops) multiplex an existing master instead of
  // racing each other to become it.
  await $`ssh ${SSH_OPTS} -MNf ${HOST}`.quiet();
}

// === PREFLIGHT: LOCAL ===

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

// === PREFLIGHT: LOCAL CHECK + REMOTE DIRTY CHECK (concurrent) ===

step(`Local check + preflight (${HOST})`);

const quickCheck = flag("quick-check");

const localCheckFailure = flag("skip-check")
  ? Promise.resolve(null as string | null)
  : (async (): Promise<string | null> => {
      if (DRY) {
        console.log(`  [dry-run] bun run check${quickCheck ? " --quick" : ""} (root + dashboard)`);
        return null;
      }
      // Root's own `check` script already ends by running the dashboard's, blackhole included - a
      // second, separately-scoped call here would just rerun that same suite a second time.
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

// === PULL ===

step(`Pulling ${branch} on ${HOST}`);
await remote(`cd ${REMOTE_ROOT} && git fetch --quiet origin ${branch} && git checkout --quiet ${branch} && git reset --hard --quiet ${head}`);
const remoteHead = await remote(`cd ${REMOTE_ROOT} && git rev-parse HEAD`);
if (!DRY && remoteHead !== head) fail(`${HOST} is at ${remoteHead.slice(0, 8)}, expected ${head.slice(0, 8)}`);
if (!DRY) console.log(`  now at ${head.slice(0, 8)}`);

// === SYNC GITIGNORED FILES ===

step("Syncing gitignored files");
for (const { path, filters = [] } of SYNC) {
  // `-rlptz`, not `-a`: everything on the server is root-owned and the services run as root, so
  // preserving the workstation's uid would rewrite ownership for no reason. Times and modes yes,
  // ownership no.
  const args = ["-rlptz", "--itemize-changes", ...(DRY ? ["--dry-run"] : []), ...filters, path, `${HOST}:${REMOTE_ROOT}/${path}`];
  const changes = (await $`rsync ${args}`.text()).trim();
  const label = DRY ? `[dry-run] ${path}` : path;
  console.log(changes ? `  ${label}:\n${changes.split("\n").map((l) => `    ${l}`).join("\n")}` : `  ${label}: already current`);
}

// === INSTALL AND BUILD ===

step("Installing dependencies and building the dashboard");
// Separate `node_modules`, no shared writes - root's install has nothing the dashboard build reads.
await Promise.all([
  remote(`cd ${REMOTE_ROOT} && bun install --frozen-lockfile`),
  remote(`cd ${REMOTE_ROOT}/dashboard && bun install --frozen-lockfile && bun run build`),
]);
if (!DRY) console.log("  built");

// === RESTART ===

step(`Restarting ${SERVICES.join(" ")}`);
await remote(`systemctl restart ${SERVICES.join(" ")}`);

// === VERIFY ===

step("Verifying");

const serviceStates = await Promise.all(
  SERVICES.map(async (service) => ({ service, state: await remote(`systemctl is-active ${service} || true`) })),
);
for (const { service, state } of serviceStates) {
  if (DRY) continue;
  const ok = state === "active";
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${service}: ${state}`);
  if (!ok) {
    failed = true;
    console.error(await remote(`journalctl -u ${service} -n 15 --no-pager`));
  }
}

// The dashboard answering is the only check that covers the build rather than the unit: a broken
// page still leaves systemd reporting `active`.
//
// Redirects are followed rather than accepted as success. `/` is a 307 to today's report, so a
// bare status check passes without a single page having rendered - which is most of what there is
// to get wrong in a build. `/context-builder` is requested too: it is the one route that reads a
// file off disk, so it fails when the harvest did not come across.
const port = (await remote(`systemctl show pidra-dashboard -p Environment --value | tr ' ' '\\n' | grep '^PORT=' | cut -d= -f2`)) || "3009";
const verifyResults = await Promise.all(
  ["/", "/context-builder"].map(async (path) => ({
    path,
    code: await remote(`curl -fsSL -o /dev/null -w '%{http_code}' --max-time 30 http://localhost:${port}${path} || true`),
  })),
);
for (const { path, code } of verifyResults) {
  if (DRY) continue;
  const ok = code === "200";
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${path} on :${port} answered ${code || "nothing"}`);
  if (!ok) failed = true;
}

// The document the briefing actually synthesises on. It is loaded by a path recorded on a run row
// by whichever machine built it, so it is exactly the thing a deploy can leave behind - and a
// missing one degrades every briefing without failing anything.
const context = await remote(
  `cd ${REMOTE_ROOT} && bun -e 'const {loadLongTermContext}=await import("./src/pipeline/long-term-context");` +
    `const c=await loadLongTermContext();` +
    `console.log((c.intelSections.length+c.personalSections.length)+" chars, "+c.standingRules.length+" rules, "+(c.problem??"ok"));` +
    `process.exit(0)'`,
);
if (!DRY) {
  const ok = !context.includes("0 chars") && context.endsWith("ok");
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[33m!\x1b[0m"} long-term context: ${context}`);
}

if (!DRY) {
  // Tears down the shared connection rather than waiting out `ControlPersist=60s` - nothing left
  // to reuse it after this.
  await $`ssh ${SSH_OPTS} -O exit ${HOST}`.quiet().catch(() => {});
}

console.log(
  failed
    ? "\n\x1b[31m✗ Deployed, but something is not healthy - see above.\x1b[0m"
    : `\n\x1b[32m✓ ${HOST} is on ${head.slice(0, 8)}.\x1b[0m`,
);
process.exit(failed ? 1 : 0);
