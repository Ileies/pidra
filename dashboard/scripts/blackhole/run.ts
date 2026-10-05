/**
 * The blackhole suite: "no request can hang" as something a check
 * proves, rather than something a phone once showed.
 *
 * Builds the dashboard, starts the production server with no database behind it, and drives the
 * system Chrome at 390x844 through a proxy per lane (`proxy.ts`) that can forward, swallow, gate or
 * refuse. Every lane first opens the app online so the worker installs and the mirror fills from a
 * synthetic snapshot (`fixture.ts`), then cuts the network in its mode and, for every page in
 * `src/lib/routes.ts`:
 *
 * 1. navigates to it client-side while the app still believes it is online - the Questions tap of
 *    2026-09-25 that spun for minutes and ended in "500 Internal Error";
 * 2. cold-starts it in a new tab, with the worker's belief reset as if it had been stopped;
 * 3. taps each of its primary controls.
 *
 * Each must reach a designed state within 4 s: the mirror's own data, `OfflineNotice`, or the
 * control's offline answer. Then no request any caller made - page, SvelteKit or worker - may have
 * outlived its budget. A lane that wrote reopens offline (the queue survived), reconnects, and
 * checks every queued write reached the stand-in exactly once, in order.
 *
 * Nothing reaches a database or the skills bridge: the server's `DATABASE_URL` and
 * `SKILLS_BRIDGE_URL` point at a closed port, the snapshot is the fixture and every write is
 * answered by the proxy.
 *
 *   bun run scripts/blackhole/run.ts                build, then every lane
 *   bun run scripts/blackhole/run.ts --no-build     against the existing build/
 *   bun run scripts/blackhole/run.ts --only gated   one mode (blackhole | gated | refused | offline)
 *   bun run scripts/blackhole/run.ts --only layout  just the desktop layout lane (`layout.ts`)
 *   bun run scripts/blackhole/race.ts               just the filter-reset race (`race.ts`), a few seconds
 *   bun run scripts/blackhole/run.ts --no-build --only blackhole --route /notes   one page, a few seconds
 *
 * Chrome is `PIDRA_CHROME`, else the first of google-chrome, chromium on PATH.
 *
 * This file is only the runner. Per-route controls are in `steps.ts`, a lane in `lane.ts`, the
 * budget and delivery assertions in `verify.ts`, shared helpers in `helpers.ts`.
 */
import { chromium } from "playwright-core";
import { MIRRORED_ROUTES, STATIC_OFFLINE_ROUTES } from "../../src/lib/offline/tiers.ts";
import { DESIGNED_WITHIN_MS, ARTIFACTS, expectedText, pathFor, results } from "./helpers.ts";
import { lanes, runLane } from "./lane.ts";
import { runLayout } from "./layout.ts";
import { runRace } from "./race.ts";
import { build, chromePath, startServer } from "./server.ts";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const route = args.includes("--route") ? args[args.indexOf("--route") + 1] : null;

if (!args.includes("--no-build")) await build();

const started = performance.now();
const server = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  const layoutRoutes = [...MIRRORED_ROUTES, ...STATIC_OFFLINE_ROUTES]
    .filter((id) => id !== "/")
    .map((id) => ({ id, path: pathFor(id), text: expectedText(id) }));
  await Promise.all([
    ...lanes(only, route).map((lane) => runLane(browser, lane, server.url)),
    ...(!route && (!only || only === "race") ? [runRace(browser, server.url)] : []),
    ...(!route && (!only || only === "layout") ? [runLayout(browser, server.url, layoutRoutes, ARTIFACTS).then((layout) => void results.push(...layout))] : []),
  ]);
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => r.error);
const byLane = Map.groupBy(results, (r) => r.lane);
for (const [lane, list] of byLane) {
  const slowest = list.filter((r) => !r.name.startsWith("first launch") && !r.name.startsWith("no request") && !r.name.startsWith("reconnect")).sort((a, b) => b.ms - a.ms)[0];
  console.log(`${lane}: ${list.length - list.filter((r) => r.error).length}/${list.length} passed${slowest ? `, slowest ${slowest.ms} ms (${slowest.name})` : ""}`);
}
if (failed.length > 0) {
  console.error(`\nblackhole: ${failed.length} failure(s)`);
  for (const r of failed) console.error(`  [${r.lane}] ${r.name}: ${r.error} (${r.ms} ms)`);
  console.error(`\nScreenshots: ${ARTIFACTS}`);
  process.exit(1);
}
console.log(`blackhole: every page and control reached a designed state within ${DESIGNED_WITHIN_MS} ms in every mode, no request outlived its budget (${Math.round((performance.now() - started) / 1000)} s)`);
