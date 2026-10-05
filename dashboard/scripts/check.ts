#!/usr/bin/env bun
/**
 * Dashboard check orchestrator. Only `svelte-kit sync` is a real prerequisite (it generates the
 * `.svelte-kit` types `svelte-check` reads); the other steps are independent and run
 * concurrently. `--quick` / `-q` skips `blackhole/run.ts`, the dominant cost (~65-70s against
 * under 4s for the rest) - not a substitute for the full check before a commit or deploy.
 * Output rules live in `scripts/lib/check-runner.ts`. The root `scripts/check.ts` runs this
 * alongside its own checks and forwards the flags.
 */
import { $ } from "bun";
import { q, quick, step, type Out } from "../../scripts/lib/check-runner";

if (!(await step("svelte-kit sync", () => q($`svelte-kit sync`)))) process.exit(1);

const steps: [string, () => Promise<Out>][] = [
  ["svelte-check", () => q($`svelte-check --tsconfig ./tsconfig.json`)],
  ["contrast", () => q($`bun run scripts/contrast.ts`)],
  ["check-offline", () => q($`bun run scripts/check-offline.ts`)],
  ["component tests", () => q($`bun test --conditions=browser tests/`)],
  ...(quick ? [] : ([["blackhole", () => q($`bun run scripts/blackhole/run.ts`)]] as [string, () => Promise<Out>][])),
];

const results = await Promise.all(steps.map(async ([label, task]) => ((await step(label, task)) ? null : label)));
const failures = results.filter((f): f is string => f !== null);

if (failures.length > 0) {
  console.error(`\ncheck: ${failures.join(", ")} failed.`);
  process.exit(1);
}

console.log(quick ? "dashboard: all steps pass (--quick, blackhole skipped)" : "dashboard: all steps pass");
