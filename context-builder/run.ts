import { utcDay } from "../src/util/time";
import { loadConfig } from "./config";
import { saveCheckpoint, makeInitialCheckpoint } from "./checkpoint";
import { loadErrors, getErrors } from "./errors";
import { startProgress, updateProgress, pauseProgress, resumeProgress, getSonnetTokens } from "./progress";
import { startMemoryWatchdog, setWatchdogRunId, setWatchdogState } from "./watchdog";
import { printInventory } from "./inventory";
import {
  detectMode,
  getResumableRun,
  markStaleRunningAsFailed,
  createRun,
  getPriorResults,
  loadStoredExtractions,
  getTotalIndexedCount,
} from "./run-tracking";
import { batchContacts } from "./pipeline/batch-contacts";
import type { EmailExtraction } from "./pipeline/extract-email";
import type { NoteExtraction } from "./pipeline/extract-note";
import type { RunCtx } from "./phases/context";
import { fetchPhase } from "./phases/fetch";
import { extractPhase } from "./phases/extract";
import { synthesizePhase } from "./phases/synthesize";
import { finalizePhase, runDbSeeding } from "./phases/finalize";

export interface ContextBuilderOptions {
  /** Rebuild from every source, ignoring the index and any previous document. */
  forceFull?: boolean;
  /** Take the update path even with no completed run on record. */
  forceUpdate?: boolean;
  /** Report the source inventory and exit, touching no run state. */
  dryRun?: boolean;
  /**
   * Re-seed the target tables from extractions already stored in context_builder_indexed_items,
   * with no fetching, no model calls and no synthesis. The cheap recovery path when a build
   * extracted everything successfully but tripped over a DB write at the very end.
   */
  seedOnly?: boolean;
  /**
   * Redo everything downstream of extraction - synthesis, output files and DB seeding - reusing
   * the stored extractions. Skips the mail/Keep fetch and every extraction call, so it costs a
   * few synthesis calls rather than a full rebuild. Tasks and GitHub are re-fetched (they are
   * never indexed) but need no model calls.
   */
  fromIndex?: boolean;
}

/** `--seed-only`: no fetching, no model calls, just the target tables from what is already indexed. */
async function seedOnlyRun(): Promise<void> {
  const { emails, notes } = await loadStoredExtractions();
  console.log(`\n=== Context Builder - seed-only ===\n`);
  console.log(`Re-seeding from ${emails.length} stored email and ${notes.length} stored note extractions.\n`);
  // errors.json is a persistent log, so count only what this invocation added.
  const errorsBefore = getErrors().length;
  await runDbSeeding(batchContacts(emails), emails, notes);
  const added = getErrors().length - errorsBefore;
  console.log(added > 0 ? `Seeding finished with ${added} new error(s) - see errors.json` : "Seeding complete.");
}

export async function runContextBuilder(options: ContextBuilderOptions = {}): Promise<void> {
  const { forceFull = false, forceUpdate = false, dryRun = false, seedOnly = false, fromIndex = false } = options;

  await loadErrors();
  if (seedOnly) return seedOnlyRun();

  const memoryWatchdog = startMemoryWatchdog();
  const config = await loadConfig();

  const today = utcDay();
  const runId = `cb-${today}-${Date.now()}`;

  // --full/--update explicitly ask for a fresh start - don't silently resume into them.
  // Any stale "running" row left behind in that case is dead, so mark it failed for hygiene.
  // A dry run must leave every bit of run state alone, so it never adopts a resumable run.
  const resumable = forceFull || forceUpdate || dryRun || fromIndex ? null : await getResumableRun();
  if (!resumable && (forceFull || forceUpdate) && !dryRun) {
    await markStaleRunningAsFailed();
  }

  // --from-index rebuilds the document from scratch out of the stored extractions, so it wants
  // full synthesis rather than a delta patch against the previous output.
  const mode = fromIndex ? "full" : resumable ? resumable.mode : await detectMode(forceFull, forceUpdate);

  console.log(`\n=== Context Builder - ${mode} mode${dryRun ? " (dry run)" : ""}${resumable ? " (resuming)" : ""} ===\n`);

  let dbRunId: string | undefined = resumable?.id;
  if (!dryRun && !dbRunId) dbRunId = await createRun(mode);
  setWatchdogRunId(dbRunId);

  let priorEmails: EmailExtraction[] = [];
  let priorNotes: NoteExtraction[] = [];
  let emailSkip = new Set<string>();
  let keepSkip = new Set<string>();

  if (fromIndex) {
    const stored = await loadStoredExtractions();
    priorEmails = stored.emails;
    priorNotes = stored.notes;
    console.log(`[run] --from-index: reusing ${stored.emails.length} email and ${stored.notes.length} note extractions; no fetch, no extraction calls\n`);
  } else if (resumable && dbRunId) {
    const emailPrior = await getPriorResults<EmailExtraction>(dbRunId, "email");
    const notePrior = await getPriorResults<NoteExtraction>(dbRunId, "keep");
    priorEmails = emailPrior.results;
    priorNotes = notePrior.results;
    emailSkip = emailPrior.skipIds;
    keepSkip = notePrior.skipIds;
    console.log(`[run] Resuming ${dbRunId}: ${priorEmails.length} emails and ${priorNotes.length} notes already extracted, reusing them\n`);
  }

  const state = makeInitialCheckpoint(runId, mode);
  setWatchdogState(state);
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

  const ctx: RunCtx = { mode, state, config, dbRunId, today, fromIndex };

  const fetched = await fetchPhase(ctx, { emailSkip, keepSkip, priorEmailCount: priorEmails.length, priorNoteCount: priorNotes.length });

  pauseProgress();
  printInventory({
    emailNew: fetched.emailItems.length,
    emailSkipped: fetched.emailSkipped,
    tasks: fetched.taskItems.length,
    keepNew: fetched.keepNewCount,
    keepSkipped: fetched.keepSkipSet.size,
    github: fetched.githubRepos.length,
    mode,
  });

  // A delta this large is better served by a full rebuild (update mode only).
  if (mode === "update") {
    const totalIndexed = await getTotalIndexedCount();
    if (totalIndexed > 0) {
      const delta = fetched.emailItems.length + fetched.keepNewCount;
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

  const extracted = await extractPhase(ctx, fetched, { emails: priorEmails, notes: priorNotes });
  const synthesis = await synthesizePhase(ctx, fetched, extracted);
  const { totalIndexed, mdPath } = await finalizePhase(ctx, fetched, extracted, synthesis);

  clearInterval(memoryWatchdog);
  if (checkpointFlush) clearInterval(checkpointFlush);

  const errors = getErrors();
  console.log(`\nContext Builder complete!`);
  console.log(`  Items indexed : ${totalIndexed}`);
  if (mdPath) console.log(`  Output        : ${mdPath}`);
  if (errors.length > 0) console.log(`  Errors logged : ${errors.length} (see context-builder/errors.json)`);
}

// Guarded, because src/job.ts imports runContextBuilder to run the monthly update under systemd.
// Without this the import alone would start a full harvest, from whatever argv the job happened
// to be invoked with.
if (import.meta.main) {
  const args = process.argv.slice(2);
  runContextBuilder({
    forceFull: args.includes("--full"),
    forceUpdate: args.includes("--update"),
    dryRun: args.includes("--dry-run"),
    seedOnly: args.includes("--seed-only"),
    fromIndex: args.includes("--from-index"),
  }).catch((err) => {
    console.error("\nContext Builder failed:", err);
    process.exit(1);
  });
}
