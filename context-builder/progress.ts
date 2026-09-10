import type { CheckpointState } from "./checkpoint";

let intervalId: Timer | null = null;
let currentState: CheckpointState | null = null;
let sonnetTokensIn = 0;
let sonnetTokensOut = 0;
let startTime = Date.now();

export function startProgress(state: CheckpointState): void {
  currentState = state;
  startTime = Date.now();
  process.stdout.write("\x1B[?25l"); // hide cursor
  intervalId = setInterval(render, 500);
  render();
}

export function updateProgress(state: CheckpointState): void {
  currentState = state;
}

export function pauseProgress(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  process.stdout.write("\x1B[?25h\n"); // show cursor + newline
}

export function resumeProgress(state: CheckpointState): void {
  currentState = state;
  process.stdout.write("\x1B[?25l");
  intervalId = setInterval(render, 500);
  render();
}

export function addSonnetTokens(tokIn: number, tokOut: number): void {
  sonnetTokensIn += tokIn;
  sonnetTokensOut += tokOut;
}

export function getSonnetTokens(): { tokensIn: number; tokensOut: number } {
  return { tokensIn: sonnetTokensIn, tokensOut: sonnetTokensOut };
}

export function stopProgress(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  render();
  process.stdout.write("\x1B[?25h\n"); // show cursor
}

// Per-phase clocks. Measuring a phase's rate against total run time made the extraction ETA
// wildly pessimistic - it was charged for the minutes the fetch phase had already spent.
// A row's counters are reused across fetch and extraction (same label, new total), so the
// clock restarts whenever the total changes or the processed count goes backwards.
const phaseClock = new Map<string, { startedAt: number; total: number; processed: number }>();

function etaStr(phase: string, total: number, processed: number): string {
  if (processed === 0 || total === 0) return "";

  const prev = phaseClock.get(phase);
  if (!prev || prev.total !== total || processed < prev.processed) {
    phaseClock.set(phase, { startedAt: Date.now(), total, processed });
    return "";
  }
  prev.processed = processed;

  const elapsed = (Date.now() - prev.startedAt) / 1000;
  if (elapsed < 1) return "";
  const rate = processed / elapsed;
  if (rate <= 0) return "";
  const remaining = (total - processed) / rate;
  if (remaining < 60) return ` ETA ${Math.round(remaining)}s`;
  if (remaining < 3600) return ` ETA ${Math.floor(remaining / 60)}m${Math.round(remaining % 60)}s`;
  return ` ETA ${Math.floor(remaining / 3600)}h${Math.floor((remaining % 3600) / 60)}m`;
}

function render(): void {
  if (!currentState) return;

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;

  // Rough running cost only. Set these to the active model's real per-million rates - the
  // defaults are the Sonnet figures the original design assumed, not the current model's.
  const rateIn = Number(process.env.AI_COST_PER_MTOK_IN ?? 3.0);
  const rateOut = Number(process.env.AI_COST_PER_MTOK_OUT ?? 15.0);
  const costEst = ((sonnetTokensIn / 1_000_000) * rateIn + (sonnetTokensOut / 1_000_000) * rateOut).toFixed(3);

  process.stdout.write("\x1B[2J\x1B[H"); // clear screen, move to top
  process.stdout.write(`\x1B[1mContext Builder\x1B[0m - ${currentState.mode} mode - ${elapsedStr} elapsed\n\n`);

  const p = currentState.phases;

  const phaseRow = (
    name: string,
    done: boolean,
    total: number,
    processed: number,
    skipped: number,
  ): void => {
    const color = done ? "\x1B[32m" : total > 0 ? "\x1B[33m" : "\x1B[90m";
    let bar: string;
    if (done) {
      bar = total > 0 ? `${total} done` : "done";
      if (skipped > 0) bar += `  (${skipped} skipped)`;
    } else if (total > 0) {
      bar = `${processed}/${total}`;
      if (skipped > 0) bar += `  (${skipped} skipped)`;
      bar += etaStr(name, total, processed);
    } else {
      bar = "…";
    }
    process.stdout.write(`  ${color}${name.padEnd(12)}\x1B[0m ${bar}\n`);
  };

  phaseRow("Email", p.email.done, p.email.total, p.email.processed, p.email.skipped);
  phaseRow("Tasks", p.tasks.done, p.tasks.total, p.tasks.processed, 0);
  phaseRow("Keep", p.keep.done, p.keep.total, p.keep.processed, p.keep.skipped);
  phaseRow("GitHub", p.github.done, p.github.total, p.github.processed, 0);

  const synthColor = p.synthesis.done ? "\x1B[32m" : "\x1B[90m";
  process.stdout.write(`  ${synthColor}Synthesis   \x1B[0m ${p.synthesis.done ? "done" : "…"}\n`);
  const seedColor = p.dbSeed.done ? "\x1B[32m" : "\x1B[90m";
  process.stdout.write(`  ${seedColor}DB Seed     \x1B[0m ${p.dbSeed.done ? "done" : "…"}\n`);

  process.stdout.write(`\n  OpenAI: ${sonnetTokensIn.toLocaleString()} in / ${sonnetTokensOut.toLocaleString()} out (~$${costEst})\n`);
  process.stdout.write("\x1B[?25h"); // show cursor momentarily for render
}
