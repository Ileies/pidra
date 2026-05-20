import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface CheckpointState {
  runId: string;
  mode: "full" | "update" | "resume";
  startedAt: string;
  phases: {
    email: { total: number; processed: number; done: boolean };
    tasks: { total: number; processed: number; done: boolean };
    keep: { total: number; processed: number; done: boolean };
    github: { total: number; processed: number; done: boolean };
    synthesis: { done: boolean };
    dbSeed: { done: boolean };
  };
  processedIds: Record<string, string[]>; // source → item IDs processed this run
}

const CHECKPOINT_PATH = resolve(import.meta.dir, ".checkpoint.json");

export async function loadCheckpoint(): Promise<CheckpointState | null> {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf-8");
    return JSON.parse(raw) as CheckpointState;
  } catch {
    return null;
  }
}

export async function saveCheckpoint(state: CheckpointState): Promise<void> {
  await writeFile(CHECKPOINT_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export async function clearCheckpoint(): Promise<void> {
  try {
    await writeFile(CHECKPOINT_PATH, "{}", "utf-8");
  } catch {}
}

export function makeInitialCheckpoint(runId: string, mode: "full" | "update" | "resume"): CheckpointState {
  return {
    runId,
    mode,
    startedAt: new Date().toISOString(),
    phases: {
      email: { total: 0, processed: 0, done: false },
      tasks: { total: 0, processed: 0, done: false },
      keep: { total: 0, processed: 0, done: false },
      github: { total: 0, processed: 0, done: false },
      synthesis: { done: false },
      dbSeed: { done: false },
    },
    processedIds: {},
  };
}
