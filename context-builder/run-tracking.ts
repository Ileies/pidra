import { db } from "../src/db";
import { contextBuilderRuns, contextBuilderIndexedItems } from "../src/db/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { pickSections, readDocument } from "../src/pipeline/long-term-context";
import type { EmailExtraction } from "./pipeline/extract-email";
import type { NoteExtraction } from "./pipeline/extract-note";

/**
 * The five numbered sections the daily pipeline routes the document by. `pickSections` splits on
 * `# N.` headings, so a document that answers with anything else reaches synthesis as an empty
 * string - which is exactly what the 2026-09-11 update run produced, and what made every briefing
 * after it run with `context doc 0 chars` while the run was recorded as completed.
 */
const REQUIRED_SECTIONS = ["1", "2", "3", "4", "5"];

export function missingSections(doc: string): string[] {
  return REQUIRED_SECTIONS.filter((n) => !pickSections(doc, n));
}

export async function detectMode(forceFull: boolean, forceUpdate: boolean): Promise<"full" | "update"> {
  if (forceFull) return "full";

  const [lastRun] = await db
    .select()
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(1);

  return (lastRun || forceUpdate) ? "update" : "full";
}

export async function getSkipSet(source: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: contextBuilderIndexedItems.itemId })
    .from(contextBuilderIndexedItems)
    .where(eq(contextBuilderIndexedItems.source, source));
  return new Set(rows.map((r) => r.itemId));
}

// A run that died mid-way (crash, OOM-kill, watchdog trip) leaves its row status="running"
// forever - find it so we can continue it instead of starting over from scratch.
export async function getResumableRun(): Promise<{ id: string; mode: "full" | "update" } | null> {
  const [row] = await db
    .select({ id: contextBuilderRuns.id, mode: contextBuilderRuns.mode })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "running"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(1);
  if (!row) return null;
  return { id: row.id, mode: row.mode === "update" ? "update" : "full" };
}

export async function markStaleRunningAsFailed(): Promise<void> {
  const stale = await db.select({ id: contextBuilderRuns.id }).from(contextBuilderRuns).where(eq(contextBuilderRuns.status, "running"));
  for (const s of stale) await markRunFailed(s.id);
}

export async function markRunFailed(id: string): Promise<void> {
  await db.update(contextBuilderRuns)
    .set({ status: "failed", completedAt: new Date().toISOString() })
    .where(eq(contextBuilderRuns.id, id));
}

export async function createRun(mode: "full" | "update"): Promise<string> {
  const [runRow] = await db
    .insert(contextBuilderRuns)
    .values({ mode, status: "running" })
    .returning({ id: contextBuilderRuns.id });
  return runRow.id;
}

export async function finalizeRun(
  id: string,
  fields: { itemsIndexed: number; outputPath: string | null },
): Promise<void> {
  await db
    .update(contextBuilderRuns)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
      itemsIndexed: fields.itemsIndexed,
      outputPath: fields.outputPath,
    })
    .where(eq(contextBuilderRuns.id, id));
}

// Items already extracted during the interrupted run are stored with their full result -
// reuse them instead of paying for extraction on the same items a second time.
export async function getPriorResults<T>(dbRunId: string, source: string): Promise<{ skipIds: Set<string>; results: T[] }> {
  const rows = await db
    .select({ itemId: contextBuilderIndexedItems.itemId, data: contextBuilderIndexedItems.data })
    .from(contextBuilderIndexedItems)
    .where(and(eq(contextBuilderIndexedItems.runId, dbRunId), eq(contextBuilderIndexedItems.source, source)));

  const skipIds = new Set<string>();
  const results: T[] = [];
  for (const r of rows) {
    if (r.data) {
      skipIds.add(r.itemId);
      results.push(r.data as T);
    }
  }
  return { skipIds, results };
}

export async function loadStoredExtractions(): Promise<{ emails: EmailExtraction[]; notes: NoteExtraction[] }> {
  const rows = await db
    .select({ source: contextBuilderIndexedItems.source, data: contextBuilderIndexedItems.data })
    .from(contextBuilderIndexedItems);

  const emails: EmailExtraction[] = [];
  const notes: NoteExtraction[] = [];
  for (const row of rows) {
    if (!row.data) continue;
    if (row.source === "email") emails.push(row.data as EmailExtraction);
    else if (row.source === "keep") notes.push(row.data as NoteExtraction);
  }
  return { emails, notes };
}

/** How far back to look for a previous document worth patching before rebuilding from scratch. */
const PREVIOUS_RUN_CANDIDATES = 5;

/**
 * The document this run updates, and the item count it was built from.
 *
 * Not simply the newest completed run. That row may be an earlier update whose output missed the
 * heading contract, and patching a broken document forward only entrenches it: the run would be
 * recorded as completed, the pipeline would still find nothing, and each month would compound it.
 * So walk back until a run yields a document that parses, which is the same choice the daily
 * pipeline makes. Nothing usable in the window means a full rebuild, which is expensive but right.
 */
export async function loadPreviousDocument(): Promise<{ context: string; itemsIndexed: number }> {
  const runs = await db
    .select({ outputPath: contextBuilderRuns.outputPath, itemsIndexed: contextBuilderRuns.itemsIndexed })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(PREVIOUS_RUN_CANDIDATES);

  for (const run of runs) {
    if (!run.outputPath) continue;
    try {
      // readDocument, not readFile: output_path holds whichever machine's absolute path ran the
      // build, so a workstation harvest is unopenable from the server and vice versa.
      const parsed = JSON.parse(await readDocument(run.outputPath)) as { fullContext?: string };
      const doc = parsed.fullContext ?? "";
      const missing = missingSections(doc);
      if (missing.length === 0) return { context: doc, itemsIndexed: run.itemsIndexed ?? 0 };
      console.warn(`[Synthesis] ${run.outputPath} is missing section(s) ${missing.join(", ")} - looking further back`);
    } catch (err) {
      console.warn(`[Synthesis] ${run.outputPath} unreadable (${err instanceof Error ? err.message : String(err)}) - looking further back`);
    }
  }
  return { context: "", itemsIndexed: 0 };
}

export async function getTotalIndexedCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contextBuilderIndexedItems);
  return Number(row?.n ?? 0);
}
