import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ErrorEntry {
  source: string;
  itemId?: string;
  error: string;
  ts: string;
}

const ERRORS_PATH = resolve(import.meta.dir, "errors.json");

let errorCache: ErrorEntry[] = [];

export async function loadErrors(): Promise<ErrorEntry[]> {
  try {
    const raw = await readFile(ERRORS_PATH, "utf-8");
    errorCache = JSON.parse(raw);
    return errorCache;
  } catch {
    errorCache = [];
    return [];
  }
}

export async function logError(source: string, error: unknown, itemId?: string): Promise<void> {
  const entry: ErrorEntry = {
    source,
    itemId,
    error: error instanceof Error ? error.message : String(error),
    ts: new Date().toISOString(),
  };
  errorCache.push(entry);
  await writeFile(ERRORS_PATH, JSON.stringify(errorCache, null, 2), "utf-8");
  console.error(`[${source}${itemId ? `:${itemId}` : ""}] Error: ${entry.error}`);
}

export function getErrors(): ErrorEntry[] {
  return errorCache;
}
