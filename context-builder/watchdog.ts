import { saveCheckpoint, type CheckpointState } from "./checkpoint";
import { markRunFailed } from "./run-tracking";

// Self-exit cleanly on runaway memory instead of waiting for the OS OOM-killer, which reaps
// the whole cgroup (took the launching terminal down with it - see incident 2026-09-15).
const MAX_RSS_MB = Number(process.env.CONTEXT_BUILDER_MAX_RSS_MB ?? 4096);

let watchdogRunId: string | undefined;
let watchdogState: CheckpointState | undefined;

export function setWatchdogRunId(id: string | undefined): void {
  watchdogRunId = id;
}

export function setWatchdogState(state: CheckpointState): void {
  watchdogState = state;
}

export function startMemoryWatchdog(): Timer {
  return setInterval(() => {
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    if (rssMb < MAX_RSS_MB) return;
    console.error(`\n[watchdog] RSS ${rssMb.toFixed(0)}MB exceeded safety limit (${MAX_RSS_MB}MB) - aborting before the OS OOM-killer has to\n`);
    void (async () => {
      try {
        if (watchdogState) await saveCheckpoint(watchdogState);
        if (watchdogRunId) await markRunFailed(watchdogRunId);
      } finally {
        process.exit(1);
      }
    })();
  }, 5000);
}
