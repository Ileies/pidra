#!/usr/bin/env bun
/**
 * Dashboard check orchestrator.
 *
 * Only `svelte-kit sync` is a real prerequisite for the rest - it generates the `.svelte-kit`
 * types `svelte-check` reads. `svelte-check`, `contrast.ts`, `check-offline.ts`, the component
 * tests (`tests/`, jsdom via happy-dom - no Chrome, no build), and
 * `blackhole/run.ts` (which does its own production build internally) don't read each other's
 * output, so chaining them with `&&` was pure waste - `blackhole/run.ts` alone is the dominant
 * cost of the whole check suite (~65-70s against under 4s for everything else combined).
 *
 * `--quick` / `-q` skips `blackhole/run.ts`, for iterating on a change that plainly can't affect
 * routing, offline behavior or rendering. It is not a substitute for the full check before a
 * commit or a deploy - `bun run deploy` and the `commit` skill both require the full run.
 *
 * Output is kept short to save tokens: each step's output is buffered and a passing step prints a
 * single `ok <step> (<secs>): <last output line>` line. The full output is printed only for a
 * failing step, or a passing one that mentions warnings (a nonzero count or a `Warn:` line).
 * `--verbose` / `-v` turns all of that off: nothing is buffered and every step streams its full
 * output live.
 *
 * Wired as the dashboard `check` script; the root `scripts/check.ts` runs this concurrently with
 * root's own checks and forwards `--quick` down to it.
 */
import { $ } from "bun";

const quick = process.argv.includes("--quick") || process.argv.includes("-q");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// With --verbose nothing is buffered: every step streams its full output live, interleaved.
const q = <T extends { quiet(): T }>(p: T): T => (verbose ? p : p.quiet());

type Out = { stdout?: Uint8Array; stderr?: Uint8Array };
const text = (o: Out) =>
  [o.stdout, o.stderr]
    .filter((b): b is Uint8Array => !!b)
    .map((b) => Buffer.from(b).toString().replace(/\x1b\[[0-9;]*m/g, "").trimEnd())
    .filter(Boolean)
    .join("\n");
const hasWarnings = (s: string) => /\b[1-9]\d* warnings?\b|^\s*warn(ing)?s?\b[:\s]|^--- .+ warnings ---/im.test(s);

async function step(label: string, task: () => Promise<Out>): Promise<boolean> {
  const started = performance.now();
  try {
    const t = text(await task());
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const last = t.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
    console.log(`ok  ${label} (${secs}s)${last ? `: ${last.slice(0, 100)}` : ""}`);
    if (hasWarnings(t)) console.log(`\n--- ${label} warnings ---\n${t}\n`);
    return true;
  } catch (err) {
    console.error(`\n=== ${label} failed ===`);
    if (!verbose) console.error(text(err as Out) || err);
    return false;
  }
}

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
