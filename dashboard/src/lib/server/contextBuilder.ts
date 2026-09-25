import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { CONTEXT_BUILDER_OUTPUT_DIR } from "$app/env/private";
import { sql } from "#lib/db.js";
import { renderMarkdown } from "#lib/markdown.js";

// Dashboard runs with cwd = dashboard/ - the actual tool lives one level up.
const PROJECT_ROOT = resolve(process.cwd(), "..");
const CHECKPOINT_PATH = resolve(PROJECT_ROOT, "context-builder/.checkpoint.json");
const ERRORS_PATH = resolve(PROJECT_ROOT, "context-builder/errors.json");
const LOG_PATH = resolve(PROJECT_ROOT, "context-builder/.dashboard-run.log");
const OUTPUT_DIR = resolve(PROJECT_ROOT, CONTEXT_BUILDER_OUTPUT_DIR ?? "context-builder/output");

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

/** How far back to look for a run that produced an actual harvest, before giving up. */
const CANDIDATE_RUNS = 6;

/**
 * Whether a run's output is the context document or something that only describes a change to it.
 * Same test the pipeline applies in `pickSections`: the shape of the document is what says whether
 * it is usable, not the `mode` column or the run's status.
 */
function isHarvestDocument(fullContext: string): boolean {
  return (/^#\s*\d+\./m).test(fullContext);
}

export interface HarvestSection {
  key: string;
  title: string;
  html: string;
  chars: number;
}

export interface HarvestDoc {
  generatedAt: string | null;
  date: string | null;
  path: string;
  fullContextHtml: string;
  chars: number;
  sections: HarvestSection[];
}

export interface HarvestRun {
  id: string;
  mode: string;
  started_at: string;
  completed_at: string | null;
  items_indexed: number | null;
  output_path: string | null;
}

/**
 * The harvested context document, rendered, plus the standing rules and active corrections layered
 * over it. Shared between the live `/context-builder` page and the offline snapshot endpoint
 * so the two never render the harvest differently.
 *
 * The newest completed run is *not* always the right row to read - a run whose output is a delta
 * rather than a document is a fraction of it, not a newer version. So the newest run that produced
 * an actual document wins, and anything newer that was skipped is reported rather than quietly
 * passed over.
 */
export async function loadHarvestDocument(): Promise<{
  run: HarvestRun | null;
  doc: HarvestDoc | null;
  docError: string | null;
  skipped: { startedAt: string; mode: string; reason: string }[];
}> {
  const db = sql();

  const runs = (await db`
    SELECT id, mode, started_at, completed_at, items_indexed, output_path
    FROM context_builder_runs
    WHERE status = 'completed'
    ORDER BY started_at DESC
    LIMIT ${CANDIDATE_RUNS}
  `) as unknown as HarvestRun[];

  let run: HarvestRun | null = null;
  let doc: HarvestDoc | null = null;
  let docError: string | null = null;
  const skipped: { startedAt: string; mode: string; reason: string }[] = [];

  for (const candidate of runs) {
    const note = (reason: string) => skipped.push({ startedAt: candidate.started_at, mode: candidate.mode, reason });

    if (!candidate.output_path) {
      note("recorded no output file");
      continue;
    }

    let raw: Record<string, string>;
    let path: string;
    try {
      const file = await readContextDocument(candidate.output_path);
      raw = JSON.parse(file.content) as Record<string, string>;
      path = file.path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      docError ??= message;
      note(message);
      continue;
    }

    const fullContext = raw.fullContext ?? "";
    if (!isHarvestDocument(fullContext)) {
      note("produced a list of changes instead of the full document, so it cannot replace it");
      continue;
    }

    const section = (key: string, title: string): HarvestSection => ({
      key,
      title,
      html: renderMarkdown(raw[key]),
      chars: (raw[key] ?? "").length,
    });
    run = candidate;
    doc = {
      generatedAt: raw.generatedAt ?? null,
      date: raw.date ?? null,
      path,
      fullContextHtml: renderMarkdown(fullContext),
      chars: fullContext.length,
      sections: [
        section("keep", "Personal knowledge (Keep notes)"),
        section("contacts", "Contact directory (email)"),
        section("github", "Technical profile (GitHub)"),
        section("tasks", "Active commitments (Tasks)"),
      ],
    };
    break;
  }

  run ??= runs[0] ?? null;

  return { run, doc, docError, skipped };
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
