import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { env } from "$env/dynamic/private";
import { sql } from "$lib/db";

// Dashboard runs with cwd = dashboard/ - the actual tool lives one level up.
const PROJECT_ROOT = resolve(process.cwd(), "..");
const CHECKPOINT_PATH = resolve(PROJECT_ROOT, "context-builder/.checkpoint.json");
const ERRORS_PATH = resolve(PROJECT_ROOT, "context-builder/errors.json");
const LOG_PATH = resolve(PROJECT_ROOT, "context-builder/.dashboard-run.log");
const OUTPUT_DIR = resolve(PROJECT_ROOT, env.CONTEXT_BUILDER_OUTPUT_DIR ?? "context-builder/output");

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

/**
 * Reads a harvest document given the path recorded on its run row, and reports which file it
 * actually opened.
 *
 * `context_builder_runs.output_path` is an absolute path written by whichever machine ran the
 * Context Builder. Every existing row was written by the workstation, so on the server the path
 * does not resolve and a plain `readFile` fails - this page showed "document unavailable" while
 * the file sat in the output directory one level up from it. The pipeline already treats the
 * stored path as a hint (`readDocument` in `src/pipeline/long-term-context.ts`), but its fallback
 * resolves against the process cwd, and the dashboard's cwd is `dashboard/`. Hence the same rule
 * anchored on PROJECT_ROOT instead.
 *
 * The resolved path comes back with the content because the page displays it, and displaying a
 * path that does not exist on this machine is how the mismatch stayed invisible in the first place.
 */
export async function readContextDocument(
  outputPath: string,
): Promise<{ content: string; path: string }> {
  try {
    return { content: await readFile(outputPath, "utf-8"), path: outputPath };
  } catch (err) {
    const local = resolve(OUTPUT_DIR, basename(outputPath));
    if (local === outputPath) throw err;
    return { content: await readFile(local, "utf-8"), path: local };
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

  const dbRun = (dbRunRows[0] as DbRun | undefined) ?? null;
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
