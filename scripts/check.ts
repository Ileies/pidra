#!/usr/bin/env bun
/**
 * Root check orchestrator.
 *
 * Root's own static checks (`tsc`, `check-skill-writes.ts`, `check-route-surfaces.ts`) and the
 * dashboard's check chain never read each other's output, but the old `&&` chain in
 * `package.json` ran them one after another anyway - including the dashboard's slowest step, the
 * headless-Chrome blackhole suite. Running both sides concurrently means `bun run check`'s wall
 * time is `max(root steps, dashboard check)` instead of their sum, and each side still fails
 * loudly and independently on its own errors.
 *
 * `--quick` / `-q` forwards to the dashboard check, which skips `blackhole/run.ts` (see
 * `dashboard/scripts/check.ts`). Root's own steps are all under a second regardless, so `--quick`
 * has nothing else to skip here. Use it while iterating on a change that plainly can't affect
 * routing, offline behavior or rendering - `bun run deploy` and the `commit` skill both require
 * the full run, not this one.
 *
 * Wired as the root `check` script; `scripts/deploy.ts` calls it once via `bun run check`.
 */
import { $ } from "bun";

const quick = process.argv.includes("--quick") || process.argv.includes("-q");
const dashboardArgs = quick ? ["--quick"] : [];

async function run(label: string, task: () => Promise<unknown>): Promise<string | null> {
  try {
    await task();
    return null;
  } catch {
    return label;
  }
}

const [rootFailure, dashboardFailure] = await Promise.all([
  run("root", async () => {
    await $`tsc --noEmit`;
    await $`bun run scripts/check-skill-writes.ts`;
    await $`bun run scripts/check-route-surfaces.ts`;
  }),
  run("dashboard", () => $`bun run check ${dashboardArgs}`.cwd("dashboard")),
]);

const failures = [rootFailure, dashboardFailure].filter((f): f is string => f !== null);
if (failures.length > 0) {
  console.error(`\ncheck: ${failures.join(" and ")} check failed - see output above.`);
  process.exit(1);
}

console.log("\ncheck: root and dashboard both pass.");
