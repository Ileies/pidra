import type { CheckpointState } from "./checkpoint";

let intervalId: Timer | null = null;
let currentState: CheckpointState | null = null;
let sonnetTokensIn = 0;
let sonnetTokensOut = 0;
let startTime = Date.now();

/**
 * The live display is a full-screen redraw: clear-screen, cursor moves, colours, twice a second.
 * Under the systemd timer there is no terminal to draw on, and every one of those frames would
 * land in the journal as a line of escape sequences - hours of a run's worth of them, burying the
 * phase errors the journal exists to show. So the same state renders as one compact line on a
 * slow clock, and only when something actually changed.
 */
const INTERACTIVE = process.stdout.isTTY === true;
const TICK_MS = INTERACTIVE ? 500 : 30_000;
let lastLine = "";

export function startProgress(state: CheckpointState): void {
  currentState = state;
  startTime = Date.now();
  if (INTERACTIVE) process.stdout.write("\x1B[?25l"); // hide cursor
  intervalId = setInterval(render, TICK_MS);
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
  if (INTERACTIVE) process.stdout.write("\x1B[?25h\n"); // show cursor + newline
}

export function resumeProgress(state: CheckpointState): void {
  currentState = state;
  if (INTERACTIVE) process.stdout.write("\x1B[?25l");
  intervalId = setInterval(render, TICK_MS);
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
  if (INTERACTIVE) process.stdout.write("\x1B[?25h\n"); // show cursor
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

/** Rough running cost, on the same two rates the dashboard uses. `null` when no rate is set. */
function costEstimate(): string | null {
  // `AI_COST_PER_MTOK_*` still wins if set, for anyone who wants the CLI readout on different
  // rates. There is deliberately no numeric fallback: the old $3/$15 defaults were Sonnet's,
  // silently applied to Luna token counts, and a dash is better than an authoritative wrong figure.
  const rateIn = Number(process.env.AI_COST_PER_MTOK_IN ?? process.env.PUBLIC_MODEL_PRICE_IN_PER_MTOK);
  const rateOut = Number(process.env.AI_COST_PER_MTOK_OUT ?? process.env.PUBLIC_MODEL_PRICE_OUT_PER_MTOK);
  if (!Number.isFinite(rateIn) || !Number.isFinite(rateOut)) return null;
  return ((sonnetTokensIn / 1_000_000) * rateIn + (sonnetTokensOut / 1_000_000) * rateOut).toFixed(3);
}

function elapsedStr(): string {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  return elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;
}

function render(): void {
  if (!currentState) return;
  if (INTERACTIVE) renderScreen();
  else renderLine();
}

/**
 * One line per state change, timestamped by the journal itself. Deliberately not a progress bar:
 * `journalctl -u pidra-context-builder` should read as a handful of phase transitions, not as a
 * transcript of every tick.
 */
function renderLine(): void {
  const p = currentState!.phases;
  const phase = (name: string, ph: { done: boolean; total: number; processed: number }) =>
    `${name} ${ph.done ? `${ph.total} done` : ph.total > 0 ? `${ph.processed}/${ph.total}` : "-"}`;

  const cost = costEstimate();
  const line =
    `[progress] ${[
      phase("email", p.email),
      phase("tasks", p.tasks),
      phase("keep", p.keep),
      phase("github", p.github),
      `synthesis ${p.synthesis.done ? "done" : "-"}`,
      `db-seed ${p.dbSeed.done ? "done" : "-"}`,
    ].join("  ")}  |  ${sonnetTokensIn} in / ${sonnetTokensOut} out` +
    (cost === null ? "" : ` (~$${cost})`);

  if (line === lastLine) return;
  lastLine = line;
  process.stdout.write(`${line}  [${elapsedStr()}]\n`);
}

function renderScreen(): void {
  const costEst = costEstimate();

  process.stdout.write("\x1B[2J\x1B[H"); // clear screen, move to top
  process.stdout.write(`\x1B[1mContext Builder\x1B[0m - ${currentState!.mode} mode - ${elapsedStr()} elapsed\n\n`);

  const p = currentState!.phases;

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

  const costStr = costEst === null ? "cost unset" : `~$${costEst}`;
  process.stdout.write(`\n  OpenAI: ${sonnetTokensIn.toLocaleString()} in / ${sonnetTokensOut.toLocaleString()} out (${costStr})\n`);
  process.stdout.write("\x1B[?25h"); // show cursor momentarily for render
}
