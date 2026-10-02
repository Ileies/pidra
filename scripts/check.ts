#!/usr/bin/env bun
/**
 * Root check orchestrator.
 *
 * Root's own static checks (`tsc`, `check-skill-writes.ts`, `check-route-surfaces.ts`) and the
 * dashboard's check chain never read each other's output, so the old `&&` chain in
 * `package.json` ran them one after another for nothing - including the dashboard's slowest step,
 * the headless-Chrome blackhole suite. Running everything concurrently means `bun run check`'s
 * wall time is the slowest part instead of the sum, and each part still fails loudly and
 * independently on its own errors.
 *
 * `--quick` / `-q` forwards to the dashboard check, which skips `blackhole/run.ts` (see
 * `dashboard/scripts/check.ts`). Root's own steps are all under a second regardless, so `--quick`
 * has nothing else to skip here. Use it while iterating on a change that plainly can't affect
 * routing, offline behavior or rendering - `bun run deploy` and the `commit` skill both require
 * the full run, not this one.
 *
 * Output is kept short to save tokens: each step's output is buffered and a passing step prints a
 * single `ok <step> (<secs>): <last output line>` line. The full output is printed only for a
 * failing step, or a passing one that mentions warnings (a nonzero count or a `Warn:` line). The
 * dashboard check does the same for its own steps and its summary is forwarded as-is.
 * `--verbose` / `-v` turns all of that off (and is forwarded to the dashboard check): nothing is
 * buffered and every step streams its full output live.
 *
 * Wired as the root `check` script; `scripts/deploy.ts` calls it once via `bun run check`.
 */
import { $ } from "bun";

const quick = process.argv.includes("--quick") || process.argv.includes("-q");
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");
const dashboardArgs = [...(quick ? ["--quick"] : []), ...(verbose ? ["--verbose"] : [])];

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
  dashboard(),
]);

if (results.includes(false)) {
  console.error("\ncheck: failed - see output above.");
  process.exit(1);
}

console.log("check: root and dashboard both pass.");
