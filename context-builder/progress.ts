import type { CheckpointState } from "./checkpoint";

interface PhaseStatus {
  name: string;
  total: number;
  processed: number;
  done: boolean;
}

let intervalId: Timer | null = null;
let currentState: CheckpointState | null = null;
let sonnetTokensIn = 0;
let sonnetTokensOut = 0;
let startTime = Date.now();

export function startProgress(state: CheckpointState): void {
  currentState = state;
  startTime = Date.now();
  clearLine();
  intervalId = setInterval(render, 500);
  render();
}

export function updateProgress(state: CheckpointState): void {
  currentState = state;
}

export function addSonnetTokens(tokIn: number, tokOut: number): void {
  sonnetTokensIn += tokIn;
  sonnetTokensOut += tokOut;
}

export function stopProgress(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  render();
  process.stdout.write("\n");
}

function clearLine(): void {
  process.stdout.write("\x1B[?25l"); // hide cursor
}

function render(): void {
  if (!currentState) return;

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m${elapsed % 60}s`;

  const phases: PhaseStatus[] = [
    { name: "Email", ...currentState.phases.email },
    { name: "Tasks", ...currentState.phases.tasks },
    { name: "Keep", ...currentState.phases.keep },
    { name: "GitHub", ...currentState.phases.github },
    { name: "Synthesis", total: 1, processed: currentState.phases.synthesis.done ? 1 : 0, done: currentState.phases.synthesis.done },
    { name: "DB Seed", total: 1, processed: currentState.phases.dbSeed.done ? 1 : 0, done: currentState.phases.dbSeed.done },
  ];

  const costEst = ((sonnetTokensIn / 1_000_000) * 3.0 + (sonnetTokensOut / 1_000_000) * 15.0).toFixed(3);

  process.stdout.write("\x1B[2J\x1B[H"); // clear screen, move to top
  process.stdout.write(`\x1B[1mContext Builder\x1B[0m — ${currentState.mode} mode — ${elapsedStr} elapsed\n\n`);

  for (const phase of phases) {
    const bar = phase.done ? "✓" : phase.total > 0 ? `${phase.processed}/${phase.total}` : "…";
    const color = phase.done ? "\x1B[32m" : "\x1B[33m";
    process.stdout.write(`  ${color}${phase.name.padEnd(12)}\x1B[0m ${bar}\n`);
  }

  process.stdout.write(`\n  Sonnet: ${sonnetTokensIn.toLocaleString()} in / ${sonnetTokensOut.toLocaleString()} out (~$${costEst})\n`);
  process.stdout.write("\x1B[?25h"); // show cursor
}
