import { errMessage } from "../src/util/text";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONTEXT_BUILDER_DIR } from "../src/config/data-dir";

export interface ErrorEntry {
  source: string;
  itemId?: string;
  error: string;
  ts: string;
}

const ERRORS_PATH = resolve(CONTEXT_BUILDER_DIR, "errors.json");

// errors.json is an append-only log persisted across runs; the cache mirrors it for the whole process.
let errorCache: ErrorEntry[] = [];

/** Must run once at startup (run.ts) so logError appends to the existing file instead of replacing it. */
export async function loadErrors(): Promise<ErrorEntry[]> {
  await mkdir(CONTEXT_BUILDER_DIR, { recursive: true });
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
    error: errMessage(error),
    ts: new Date().toISOString(),
  };
  errorCache.push(entry);
  await writeFile(ERRORS_PATH, JSON.stringify(errorCache, null, 2), "utf-8");
  console.error(`[${source}${itemId ? `:${itemId}` : ""}] Error: ${entry.error}`);
}

export function getErrors(): ErrorEntry[] {
  return errorCache;
}
