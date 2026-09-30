#!/usr/bin/env bun
/**
 * Dashboard check orchestrator.
 *
 * Only `svelte-kit sync` is a real prerequisite for the rest - it generates the `.svelte-kit`
 * types `svelte-check` reads. `svelte-check`, `contrast.ts`, `check-offline.ts`, the source-links
 * test, and `blackhole/run.ts` (which does its own production build internally) don't read each
 * other's output, so chaining them with `&&` was pure waste - `blackhole/run.ts` alone is the
 * dominant cost of the whole check suite (~65-70s against under 4s for everything else combined).
 *
 * `--quick` / `-q` skips `blackhole/run.ts`, for iterating on a change that plainly can't affect
 * routing, offline behavior or rendering. It is not a substitute for the full check before a
 * commit or a deploy - `bun run deploy` and the `commit` skill both require the full run.
 *
 * Wired as the dashboard `check` script; the root `scripts/check.ts` runs this concurrently with
 * root's own checks and forwards `--quick` down to it.
 */
import { $ } from "bun";

const quick = process.argv.includes("--quick") || process.argv.includes("-q");

await $`svelte-kit sync`;

const steps: [string, () => Promise<unknown>][] = [
  ["svelte-check", () => $`svelte-check --tsconfig ./tsconfig.json`],
  ["contrast", () => $`bun run scripts/contrast.ts`],
  ["check-offline", () => $`bun run scripts/check-offline.ts`],
  ["source-links", () => $`bun test scripts/source-links.test.ts`],
  ...(quick ? [] : ([["blackhole", () => $`bun run scripts/blackhole/run.ts`]] as [string, () => Promise<unknown>][])),
];

if (quick) console.log("check --quick: skipping blackhole/run.ts");

const failures = (
  await Promise.all(
    steps.map(async ([label, task]) => {
      try {
        await task();
        return null;
      } catch {
        return label;
      }
    }),
  )
).filter((f): f is string => f !== null);

if (failures.length > 0) {
  console.error(`\ncheck: ${failures.join(", ")} failed - see output above.`);
  process.exit(1);
}

console.log("\ncheck: all steps pass.");
