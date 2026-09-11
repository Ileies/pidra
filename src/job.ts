/**
 * One-shot job runner: runs exactly one scheduled job, then exits.
 *
 * Scheduling lives in NixOS systemd timers (hosts/pronix/pidra.nix in the
 * nixos flake), not in this process - so each run gets a fresh process, its
 * own journal entry, and a real exit code. A non-zero exit marks the systemd
 * unit failed, which is what makes a missed run visible.
 *
 *   bun run src/job.ts pipeline [YYYY-MM-DD]
 *   bun run src/job.ts feedback [YYYY-MM-DD]
 *   bun run src/job.ts source-scoring
 *   bun run src/job.ts meta-run
 *   bun run src/job.ts review
 *   bun run src/job.ts prune
 */

import { runPipeline } from "./pipeline/run";
import { runImplicitFeedback } from "./pipeline/implicit-feedback";
import { runWeeklySourceScoring } from "./pipeline/weekly-source-scoring";
import { runWeeklyMetaRun } from "./pipeline/weekly-meta-run";
import { runWeeklyReview } from "./pipeline/weekly-review";
import { pruneEntityGraph } from "./pipeline/entity-pruning";

const today = () => new Date().toISOString().split("T")[0]!;

const JOBS: Record<string, (date: string) => Promise<unknown>> = {
  "pipeline": (date) => runPipeline(date),
  "feedback": (date) => runImplicitFeedback(date),
  "source-scoring": () => runWeeklySourceScoring(),
  "meta-run": () => runWeeklyMetaRun(),
  "review": () => runWeeklyReview(),
  "prune": () => pruneEntityGraph(),
};

const [name, dateArg] = process.argv.slice(2);

if (!name || !(name in JOBS)) {
  console.error(`Usage: bun run src/job.ts <${Object.keys(JOBS).join("|")}> [YYYY-MM-DD]`);
  process.exit(2);
}

const date = dateArg ?? today();
const started = Date.now();
console.log(`[job] ${name} starting (date=${date})`);

try {
  await JOBS[name]!(date);
  console.log(`[job] ${name} completed in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
} catch (err) {
  console.error(`[job] ${name} failed after ${Math.round((Date.now() - started) / 1000)}s:`, err);
  process.exit(1);
}
