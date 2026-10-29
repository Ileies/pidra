import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { sql } from "#lib/server/postgres.js";
import { DATA_DIR } from "$app/env/private";

// Dashboard runs with cwd = dashboard/ - the actual tool lives one level up.
const PROJECT_ROOT = resolve(process.cwd(), "..");
// Same directory the root's Context Builder writes (src/config/data-dir.ts).
const CONTEXT_BUILDER_DIR = resolve(PROJECT_ROOT, DATA_DIR, "context-builder");
const CHECKPOINT_PATH = resolve(CONTEXT_BUILDER_DIR, ".checkpoint.json");
const ERRORS_PATH = resolve(CONTEXT_BUILDER_DIR, "errors.json");
const LOG_PATH = resolve(CONTEXT_BUILDER_DIR, ".dashboard-run.log");

export interface PhaseProgress {
  total: number;
  processed: number;
  skipped: number;
  done: boolean;
}

export interface CheckpointState {
  runId: string;
  mode: string;
  startedAt: string;
  phases: {
    email: PhaseProgress;
    tasks: PhaseProgress;
    keep: PhaseProgress;
    github: PhaseProgress;
    synthesis: { done: boolean };
    dbSeed: { done: boolean };
  };
  openaiTokensIn: number;
  openaiTokensOut: number;
}

export interface DbRun {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  items_indexed: number | null;
}

export interface CbError {
  source: string;
  error: string;
  ts: string;
}

export interface ContextBuilderStatus {
  running: boolean;
  trackedByDashboard: boolean;
  pid: number | null;
  rssMb: number | null;
  dbRun: DbRun | null;
  checkpoint: CheckpointState | null;
  errors: CbError[];
}

let child: ReturnType<typeof Bun.spawn> | null = null;

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    if (!raw.trim() || raw.trim() === "{}") return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function getRssMb(pid: number): Promise<number | null> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s*(\d+)\s*kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<ContextBuilderStatus> {
  const [dbRunRows, checkpoint, errors] = await Promise.all([
    sql()`SELECT id, mode, status, started_at, completed_at, items_indexed FROM context_builder_runs ORDER BY started_at DESC LIMIT 1`,
    readJsonFile<CheckpointState>(CHECKPOINT_PATH),
    readJsonFile<CbError[]>(ERRORS_PATH),
  ]);

  const dbRun = dbRunRows[0] as DbRun | undefined ?? null;
  const trackedPid = child?.pid ?? null;
  const alive = trackedPid != null && isAlive(trackedPid);
  const rssMb = alive && trackedPid != null ? await getRssMb(trackedPid) : null;

  return {
    running: dbRun?.status === "running",
    trackedByDashboard: alive,
    pid: alive ? trackedPid : null,
    rssMb,
    dbRun,
    checkpoint,
    errors: errors ?? [],
  };
}

export function startRun(mode: "full" | "update" | null): { ok: boolean; error?: string } {
  if (child) {
    const exitCode = child.exitCode;
    if (exitCode === null) {
      return { ok: false, error: "A run is already active (started from this dashboard)." };
    }
  }

  const args = ["run", "context-builder/run.ts"];
  if (mode) args.push(`--${mode}`);

  // The log file is opened before the child exists, so its directory has to exist first.
  mkdirSync(CONTEXT_BUILDER_DIR, { recursive: true });
  child = Bun.spawn({
    cmd: ["bun", ...args],
    cwd: PROJECT_ROOT,
    stdout: Bun.file(LOG_PATH),
    stderr: Bun.file(LOG_PATH),
  });
  child.unref();
  return { ok: true };
}

export function stopRun(): { ok: boolean; error?: string } {
  if (!child || child.exitCode !== null) {
    return { ok: false, error: "No dashboard-tracked run to stop (it may have been started outside the dashboard)." };
  }
  child.kill();
  return { ok: true };
}
