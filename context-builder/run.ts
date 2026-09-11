import { loadConfig } from "./config";
import {
  saveCheckpoint,
  clearCheckpoint,
  makeInitialCheckpoint,
  type CheckpointState,
} from "./checkpoint";
import { loadErrors, logError, getErrors } from "./errors";
import { startProgress, updateProgress, stopProgress, pauseProgress, resumeProgress, getSonnetTokens } from "./progress";
import { fetchEmailItems, type EmailItem } from "./sources/email";
import { fetchTaskItems } from "./sources/tasks";
import { fetchKeepNotes } from "./sources/keep";
import { fetchGitHubRepos } from "./sources/github";
import { extractEmails, type EmailExtraction } from "./pipeline/extract-email";
import { extractNotes, type NoteExtraction } from "./pipeline/extract-note";
import { batchContacts } from "./pipeline/batch-contacts";
import {
  synthesizeContacts,
  synthesizeTasks,
  synthesizeKeep,
  synthesizeGitHub,
  synthesizeFullContext,
  synthesizePatch,
  type SynthesisResult,
} from "./pipeline/synthesize";
import { listActiveCorrections, formatForPrompt } from "../src/context/corrections";
import { seedContacts, seedEntities, seedStandingContext } from "./output/db-writer";
import { writeOutputFiles } from "./output/builder";
import { db } from "../src/db";
import { contextBuilderRuns, contextBuilderIndexedItems } from "../src/db/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const forceFull = args.includes("--full");
const forceUpdate = args.includes("--update");
const dryRun = args.includes("--dry-run");
// Re-seed the target tables from extractions already stored in context_builder_indexed_items,
// with no fetching, no model calls and no synthesis. This is the cheap recovery path when a
// build extracted everything successfully but tripped over a DB write at the very end.
const seedOnly = args.includes("--seed-only");
// Redo everything downstream of extraction - synthesis, output files and DB seeding - reusing
// the stored extractions. Skips the mail/Keep fetch and every extraction call, so it costs a
// few synthesis calls rather than a full rebuild. Tasks and GitHub are re-fetched (they are
// never indexed) but need no model calls.
const fromIndex = args.includes("--from-index");

// Self-exit cleanly on runaway memory instead of waiting for the OS OOM-killer, which reaps
// the whole cgroup (took the launching terminal down with it - see incident 2026-09-15).
const MAX_RSS_MB = Number(process.env.CONTEXT_BUILDER_MAX_RSS_MB ?? 4096);
let watchdogRunId: string | undefined;
let watchdogState: CheckpointState | undefined;

function startMemoryWatchdog(): Timer {
  return setInterval(() => {
    const rssMb = process.memoryUsage().rss / 1024 / 1024;
    if (rssMb < MAX_RSS_MB) return;
    console.error(`\n[watchdog] RSS ${rssMb.toFixed(0)}MB exceeded safety limit (${MAX_RSS_MB}MB) - aborting before the OS OOM-killer has to\n`);
    void (async () => {
      try {
        if (watchdogState) await saveCheckpoint(watchdogState);
        if (watchdogRunId) {
          await db.update(contextBuilderRuns)
            .set({ status: "failed", completedAt: new Date().toISOString() })
            .where(eq(contextBuilderRuns.id, watchdogRunId));
        }
      } finally {
        process.exit(1);
      }
    })();
  }, 5000);
}

async function detectMode(): Promise<"full" | "update"> {
  if (forceFull) return "full";

  const [lastRun] = await db
    .select()
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "completed"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(1);

  return (lastRun || forceUpdate) ? "update" : "full";
}

async function getSkipSet(source: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: contextBuilderIndexedItems.itemId })
    .from(contextBuilderIndexedItems)
    .where(eq(contextBuilderIndexedItems.source, source));
  return new Set(rows.map((r) => r.itemId));
}

// A run that died mid-way (crash, OOM-kill, watchdog trip) leaves its row status="running"
// forever - find it so we can continue it instead of starting over from scratch.
async function getResumableRun(): Promise<{ id: string; mode: "full" | "update" } | null> {
  const [row] = await db
    .select({ id: contextBuilderRuns.id, mode: contextBuilderRuns.mode })
    .from(contextBuilderRuns)
    .where(eq(contextBuilderRuns.status, "running"))
    .orderBy(desc(contextBuilderRuns.startedAt))
    .limit(1);
  if (!row) return null;
  return { id: row.id, mode: row.mode === "update" ? "update" : "full" };
}

// Items already extracted during the interrupted run are stored with their full result -
// reuse them instead of re-running (potentially expensive) Ollama extraction on them again.
async function getPriorResults<T>(dbRunId: string, source: string): Promise<{ skipIds: Set<string>; results: T[] }> {
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

/**
 * Seeds each target table independently: these three are the whole point of the run, and a
 * failure writing one must not silently skip the others (a transient error during the entity
 * batch used to leave standing_context empty with the run still reported complete).
 */
async function runDbSeeding(
  contactProfiles: ReturnType<typeof batchContacts>,
  emailExtractions: EmailExtraction[],
  noteExtractions: NoteExtraction[],
): Promise<void> {
  for (const [label, seed] of [
    ["db-seed:contacts", () => seedContacts(contactProfiles)],
    ["db-seed:entities", () => seedEntities(emailExtractions, noteExtractions)],
    ["db-seed:standing-context", () => seedStandingContext(noteExtractions)],
  ] as const) {
    try {
      await seed();
    } catch (err) {
      await logError(`phase:${label}`, err);
    }
  }
}

async function loadStoredExtractions(): Promise<{ emails: EmailExtraction[]; notes: NoteExtraction[] }> {
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

async function getTotalIndexedCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(contextBuilderIndexedItems);
  return Number(row?.n ?? 0);
}

function printInventory(info: {
  emailNew: number; emailSkipped: number;
  tasks: number;
  keepNew: number; keepSkipped: number;
  github: number;
  mode: string;
}): void {
  const col = (s: string, w: number) => s.padEnd(w);
  console.log("\n=== Source Inventory ===");
  if (info.mode === "update") {
    console.log(`  ${col("Email", 10)} ${info.emailNew} new  (${info.emailSkipped} already indexed)`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks} (always re-fetched)`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew} new  (${info.keepSkipped} already indexed)`);
  } else {
    console.log(`  ${col("Email", 10)} ${info.emailNew}`);
    console.log(`  ${col("Tasks", 10)} ${info.tasks}`);
    console.log(`  ${col("Keep", 10)} ${info.keepNew}`);
  }
  console.log(`  ${col("GitHub", 10)} ${info.github} repos (always re-fetched)`);
  console.log("========================\n");
}

async function main(): Promise<void> {
  await loadErrors();

  if (seedOnly) {
    const { emails, notes } = await loadStoredExtractions();
    console.log(`\n=== Context Builder - seed-only ===\n`);
    console.log(`Re-seeding from ${emails.length} stored email and ${notes.length} stored note extractions.\n`);
    // errors.json is a persistent log, so count only what this invocation added.
    const errorsBefore = getErrors().length;
    await runDbSeeding(batchContacts(emails), emails, notes);
    const added = getErrors().length - errorsBefore;
    console.log(added > 0 ? `Seeding finished with ${added} new error(s) - see errors.json` : "Seeding complete.");
    return;
  }

  const memoryWatchdog = startMemoryWatchdog();
  const config = loadConfig();

  const today = new Date().toISOString().split("T")[0];
  const runId = `cb-${today}-${Date.now()}`;

  // --full/--update explicitly ask for a fresh start - don't silently resume into them.
  // Any stale "running" row left behind in that case is dead, so mark it failed for hygiene.
  // A dry run must leave every bit of run state alone, so it never adopts a resumable run.
  const resumable = forceFull || forceUpdate || dryRun || fromIndex ? null : await getResumableRun();
  if (!resumable && (forceFull || forceUpdate) && !dryRun) {
    const stale = await db.select({ id: contextBuilderRuns.id }).from(contextBuilderRuns).where(eq(contextBuilderRuns.status, "running"));
    for (const s of stale) {
      await db.update(contextBuilderRuns).set({ status: "failed", completedAt: new Date().toISOString() }).where(eq(contextBuilderRuns.id, s.id));
    }
  }

  // --from-index rebuilds the document from scratch out of the stored extractions, so it wants
  // full synthesis rather than a delta patch against the previous output.
  const mode = fromIndex ? "full" : resumable ? resumable.mode : await detectMode();

  console.log(`\n=== Context Builder - ${mode} mode${dryRun ? " (dry run)" : ""}${resumable ? " (resuming)" : ""} ===\n`);

  let dbRunId: string | undefined = resumable?.id;
  if (!dryRun && !dbRunId) {
    const [runRow] = await db
      .insert(contextBuilderRuns)
      .values({ mode, status: "running" })
      .returning({ id: contextBuilderRuns.id });
    dbRunId = runRow.id;
  }
  watchdogRunId = dbRunId;

  let priorEmailResults: EmailExtraction[] = [];
  let priorNoteResults: NoteExtraction[] = [];
  let resumeEmailSkip = new Set<string>();
  let resumeKeepSkip = new Set<string>();

  if (fromIndex) {
    const stored = await loadStoredExtractions();
    priorEmailResults = stored.emails;
    priorNoteResults = stored.notes;
    console.log(`[run] --from-index: reusing ${stored.emails.length} email and ${stored.notes.length} note extractions; no fetch, no extraction calls\n`);
  } else if (resumable && dbRunId) {
    const emailPrior = await getPriorResults<EmailExtraction>(dbRunId, "email");
    const notePrior = await getPriorResults<NoteExtraction>(dbRunId, "keep");
    priorEmailResults = emailPrior.results;
    priorNoteResults = notePrior.results;
    resumeEmailSkip = emailPrior.skipIds;
    resumeKeepSkip = notePrior.skipIds;
    console.log(`[run] Resuming ${dbRunId}: ${priorEmailResults.length} emails and ${priorNoteResults.length} notes already extracted, reusing them\n`);
  }

  const state: CheckpointState = makeInitialCheckpoint(runId, mode);
  watchdogState = state;
  if (!dryRun) await saveCheckpoint(state);
  startProgress(state);

  // Flush a live snapshot to disk regularly (not just at phase boundaries) so external
  // consumers (e.g. the dashboard) can show near-real-time progress.
  const checkpointFlush = dryRun ? null : setInterval(() => {
    const tokens = getSonnetTokens();
    state.openaiTokensIn = tokens.tokensIn;
    state.openaiTokensOut = tokens.tokensOut;
    void saveCheckpoint(state);
  }, 2000);

  // === FETCH PHASE ===

  let allEmailItems: EmailItem[] = [];
  let emailSkipped = 0;
  let emailSkipSet = new Set<string>();

  try {
    emailSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("email");
    for (const id of resumeEmailSkip) emailSkipSet.add(id);
    // Each account is an independent IMAP connection with no shared state beyond emailSkipSet
    // (read-only during fetch), so they fetch concurrently instead of one at a time - the mail
    // fetch had become the whole runtime. fetchEmailItems already retries and logs its own errors
    // internally, so a single account's failure never aborts the others.
    const results = await Promise.all(
      (fromIndex ? [] : config.emailAccounts)
        .filter((account) => !account.isNewsAccount)
        .map((account) =>
          fetchEmailItems(account, config.emailYears, emailSkipSet, {
            onHeaderCount: (n) => {
              state.phases.email.total += n;
              updateProgress(state);
            },
            onItemDone: () => {
              state.phases.email.processed += 1;
              updateProgress(state);
            },
          }),
        ),
    );
    for (const { items, skipped } of results) {
      allEmailItems.push(...items);
      emailSkipped += skipped;
    }
    state.phases.email.total = allEmailItems.length + priorEmailResults.length;
    state.phases.email.processed = priorEmailResults.length;
    state.phases.email.skipped = emailSkipped;
  } catch (err) {
    await logError("phase:email-fetch", err);
  }
  updateProgress(state);

  let taskItems: Awaited<ReturnType<typeof fetchTaskItems>> = [];
  try {
    taskItems = await fetchTaskItems();
    state.phases.tasks.total = taskItems.length;
    state.phases.tasks.done = true;
  } catch (err) {
    await logError("phase:tasks-fetch", err);
    state.phases.tasks.done = true;
  }
  updateProgress(state);

  let keepNotes: Awaited<ReturnType<typeof fetchKeepNotes>> = [];
  let keepSkipSet = new Set<string>();
  let keepNewCount = 0;

  try {
    keepSkipSet = mode === "full" ? new Set<string>() : await getSkipSet("keep");
    for (const id of resumeKeepSkip) keepSkipSet.add(id);
    keepNotes = fromIndex ? [] : await fetchKeepNotes();
    keepNewCount = keepNotes.filter((n) => !keepSkipSet.has(n.id)).length;
    state.phases.keep.total = keepNewCount + priorNoteResults.length;
    state.phases.keep.processed = priorNoteResults.length;
    state.phases.keep.skipped = keepSkipSet.size;
  } catch (err) {
    await logError("phase:keep-fetch", err);
  }
  updateProgress(state);

  let githubRepos: Awaited<ReturnType<typeof fetchGitHubRepos>> = [];
  try {
    if (config.githubToken) {
      githubRepos = await fetchGitHubRepos(config.githubToken);
    }
    state.phases.github.total = githubRepos.length;
    state.phases.github.done = true;
  } catch (err) {
    await logError("phase:github-fetch", err);
    state.phases.github.done = true;
  }
  updateProgress(state);

  // === INVENTORY TABLE ===
  pauseProgress();
  printInventory({
    emailNew: allEmailItems.length,
    emailSkipped,
    tasks: taskItems.length,
    keepNew: keepNewCount,
    keepSkipped: keepSkipSet.size,
    github: githubRepos.length,
    mode,
  });

  // === 30% DELTA WARNING (update mode only) ===
  if (mode === "update") {
    const totalIndexed = await getTotalIndexedCount();
    if (totalIndexed > 0) {
      const delta = allEmailItems.length + keepNewCount;
      const ratio = delta / totalIndexed;
      if (ratio > 0.3) {
        console.warn(`WARNING: Delta (${delta} items) is ${Math.round(ratio * 100)}% of existing index (${totalIndexed} items).`);
        console.warn(`Consider running with --full for a cleaner result. Proceeding with update anyway.\n`);
      }
    }
  }

  if (dryRun) {
    // Deliberately no DB write and no clearCheckpoint() here: a dry run reports the inventory
    // and exits without disturbing the run history or an interrupted run's resume state.
    clearInterval(memoryWatchdog);
    if (checkpointFlush) clearInterval(checkpointFlush);
    return;
  }

  resumeProgress(state);

  // === EXTRACTION PHASE ===

  let emailExtractions: EmailExtraction[] = [...priorEmailResults];
  try {
    if (allEmailItems.length > 0) {
      const newExtractions = await extractEmails(allEmailItems, dbRunId!, today, (done) => {
        state.phases.email.processed = priorEmailResults.length + done;
        updateProgress(state);
      });
      emailExtractions.push(...newExtractions);
    }
  } catch (err) {
    await logError("phase:email-extract", err);
  } finally {
    state.phases.email.done = true;
    await saveCheckpoint(state);
    updateProgress(state);
  }

  let noteExtractions: NoteExtraction[] = [...priorNoteResults];
  try {
    if (keepNotes.length > 0) {
      const newNotes = await extractNotes(keepNotes, dbRunId!, keepSkipSet, (done) => {
        state.phases.keep.processed = priorNoteResults.length + done;
        updateProgress(state);
      });
      noteExtractions.push(...newNotes);
    }
  } catch (err) {
    await logError("phase:keep-extract", err);
  } finally {
    state.phases.keep.done = true;
    await saveCheckpoint(state);
    updateProgress(state);
  }

  // === SYNTHESIS PHASE (always runs with whatever data is available) ===

  const contactProfiles = batchContacts(emailExtractions);
  const notesByCategory = noteExtractions.reduce((map, n) => {
    const arr = map.get(n.category) ?? [];
    arr.push(n);
    map.set(n.category, arr);
    return map;
  }, new Map<string, typeof noteExtractions>());

  let parts: Omit<SynthesisResult, "fullContext"> = { contacts: "", tasks: "", keep: "", github: "" };
  let fullContext = "";

  try {
    const [contactsSummary, tasksSummary, keepSummary, githubSummary] = await Promise.allSettled([
      emailExtractions.length > 0 ? synthesizeContacts(contactProfiles) : Promise.resolve("No email data"),
      taskItems.length > 0 ? synthesizeTasks(taskItems) : Promise.resolve("No task data"),
      noteExtractions.length > 0 ? synthesizeKeep(notesByCategory) : Promise.resolve("No Keep data"),
      githubRepos.length > 0 ? synthesizeGitHub(githubRepos) : Promise.resolve("No GitHub data"),
    ]);

    parts = {
      contacts: contactsSummary.status === "fulfilled" ? contactsSummary.value : "",
      tasks: tasksSummary.status === "fulfilled" ? tasksSummary.value : "",
      keep: keepSummary.status === "fulfilled" ? keepSummary.value : "",
      github: githubSummary.status === "fulfilled" ? githubSummary.value : "",
    };

    // Read-only input to synthesis. A build re-derives the document from the same sources that
    // produced a corrected mistake, and an update run hands the previous document over verbatim,
    // so without these the run reinstates what the user has already corrected. Nothing here
    // writes, edits or deletes a correction: the layer stays authoritative over what comes out.
    const corrections = formatForPrompt(await listActiveCorrections());
    if (corrections.length > 0) {
      console.log(`[Synthesis] ${corrections.length} active correction(s) injected`);
    }

    if (mode === "update") {
      const [lastRun] = await db
        .select({ outputPath: contextBuilderRuns.outputPath, itemsIndexed: contextBuilderRuns.itemsIndexed })
        .from(contextBuilderRuns)
        .where(eq(contextBuilderRuns.status, "completed"))
        .orderBy(desc(contextBuilderRuns.startedAt))
        .limit(1);

      let existingContext = "";
      if (lastRun?.outputPath) {
        try {
          const prevJson = JSON.parse(await readFile(lastRun.outputPath, "utf-8")) as { fullContext?: string };
          existingContext = prevJson.fullContext ?? "";
        } catch {}
      }

      const existingCount = lastRun?.itemsIndexed ?? 0;
      const deltaCount = emailExtractions.length + noteExtractions.length + githubRepos.length;

      fullContext = existingContext
        ? await synthesizePatch(existingContext, parts, { existing: existingCount, delta: deltaCount }, corrections)
        : await synthesizeFullContext(parts, corrections);
    } else {
      fullContext = await synthesizeFullContext(parts, corrections);
    }
  } catch (err) {
    await logError("phase:synthesis", err);
  }

  state.phases.synthesis.done = true;
  updateProgress(state);

  // === OUTPUT FILES ===
  let jsonPath = "";
  let mdPath = "";
  try {
    const paths = await writeOutputFiles(
      { ...parts, fullContext },
      config.outputDir,
      today,
    );
    jsonPath = paths.jsonPath;
    mdPath = paths.mdPath;
  } catch (err) {
    await logError("phase:output", err);
  }

  // === DB SEEDING ===
  await runDbSeeding(contactProfiles, emailExtractions, noteExtractions);

  state.phases.dbSeed.done = true;
  updateProgress(state);

  // === FINALIZE ===
  const totalIndexed = emailExtractions.length + noteExtractions.length + githubRepos.length + taskItems.length;

  if (dbRunId) {
    await db
      .update(contextBuilderRuns)
      .set({ status: "completed", completedAt: new Date().toISOString(), itemsIndexed: totalIndexed, outputPath: jsonPath || null })
      .where(eq(contextBuilderRuns.id, dbRunId));
  }

  await clearCheckpoint();
  stopProgress();
  clearInterval(memoryWatchdog);
  if (checkpointFlush) clearInterval(checkpointFlush);

  const errors = getErrors();
  console.log(`\nContext Builder complete!`);
  console.log(`  Items indexed : ${totalIndexed}`);
  if (mdPath) console.log(`  Output        : ${mdPath}`);
  if (errors.length > 0) console.log(`  Errors logged : ${errors.length} (see context-builder/errors.json)`);
}

main().catch(async (err) => {
  console.error("\nContext Builder failed:", err);
  process.exit(1);
});
