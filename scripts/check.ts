#!/usr/bin/env bun
/**
 * Root check orchestrator: root's own static checks and the dashboard check chain run
 * concurrently, so `bun run check` takes as long as the slowest part (the dashboard's blackhole
 * suite) instead of the sum. `--quick` / `-q` and `--verbose` / `-v` are forwarded to the
 * dashboard check; see `scripts/lib/check-runner.ts` for the output rules. `bun run deploy` and
 * the `commit` skill require the full run, not `--quick`. Steps: root tsc, check-skill-writes,
 * check-route-surfaces, check-file-size, then `dashboard/scripts/check.ts`.
 */
import { $ } from "bun";
import { q, quick, step, text, verbose, type Out } from "./lib/check-runner";

const dashboardArgs = [...(quick ? ["--quick"] : []), ...(verbose ? ["--verbose"] : [])];

async function dashboard(): Promise<boolean> {
  try {
    const out = await q($`bun run check ${dashboardArgs}`.cwd("dashboard"));
    if (!verbose) console.log(text(out).split("\n").filter((l) => !l.startsWith("$ ")).join("\n"));
    return true;
  } catch (err) {
    if (!verbose) console.error(text(err as Out) || err);
    return false;
  }
}

const results = await Promise.all([
  step("tsc", () => q($`tsc --noEmit`)),
  step("skill-writes", () => q($`bun run scripts/check-skill-writes.ts`)),
  step("route-surfaces", () => q($`bun run scripts/check-route-surfaces.ts`)),
  step("openai-rules", () => q($`bun run scripts/check-openai-rules.ts`)),
  step("file-size", () => q($`bun run scripts/check-file-size.ts`)),
  step("unit tests", () => q($`bun test ./tests`)),
  dashboard(),
]);

if (results.includes(false)) {
  console.error("\ncheck: failed - see output above.");
  process.exit(1);
}

console.log("check: root and dashboard both pass.");
