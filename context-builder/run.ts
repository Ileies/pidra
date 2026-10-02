import { loadConfig } from "./config";
import {
  saveCheckpoint,
  clearCheckpoint,
  makeInitialCheckpoint,
  type CheckpointState,
} from "./checkpoint";
import { loadErrors, logError, getErrors } from "./errors";
import { startProgress, updateProgress, stopProgress, pauseProgress, resumeProgress, getSonnetTokens } from "./progress";
import { startMemoryWatchdog, setWatchdogRunId, setWatchdogState } from "./watchdog";
import { printInventory } from "./inventory";
import {
  detectMode,
  getSkipSet,
  getResumableRun,
  markStaleRunningAsFailed,
  createRun,
  finalizeRun,
  getPriorResults,
  loadStoredExtractions,
  loadPreviousDocument,
  getTotalIndexedCount,
  missingSections,
} from "./run-tracking";
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
import { seedContacts, seedEntities, seedRuleNotes } from "./output/db-writer";
import { writeOutputFiles, type ContextDocument } from "./output/builder";

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

/**
 * Seeds each target table independently: these three are the whole point of the run, and a
 * failure writing one must not silently skip the others (a transient error during the entity
 * batch used to leave rule notes unseeded with the run still reported complete).
 */
async function runDbSeeding(
  contactProfiles: ReturnType<typeof batchContacts>,
  emailExtractions: EmailExtraction[],
  noteExtractions: NoteExtraction[],
): Promise<void> {
  for (const [label, seed] of [
    ["db-seed:contacts", () => seedContacts(contactProfiles)],
    ["db-seed:entities", () => seedEntities(emailExtractions, noteExtractions)],
    ["db-seed:rule-notes", () => seedRuleNotes(noteExtractions)],
  ] as const) {
    try {
      await seed();
    } catch (err) {
      await logError(`phase:${label}`, err);
    }
  }
}

export async function runContextBuilder(options: ContextBuilderOptions = {}): Promise<void> {
  const { forceFull = false, forceUpdate = false, dryRun = false, seedOnly = false, fromIndex = false } = options;

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
  const config = await loadConfig();

  const today = new Date().toISOString().split("T")[0];
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

  // The standalone Contacts/Keep sections - and the "new information" handed to synthesizePatch -
  // must reflect the full current corpus in update mode, not just today's delta, or they collapse
  // to whatever changed today (2026-09-11: "Personal Knowledge (Keep)" shrank from 641 to 71 lines
  // off a single-note delta, and the Contacts Summary's low-importance breakdown vanished). Tasks
  // and GitHub don't have this problem since they're always refetched in full; email and Keep need
  // it explicitly because their fetch is delta-only via the skip-set. DB seeding below stays on
  // the delta-only sets - seedContacts/seedEntities/seedRuleNotes are upserts against
  // already-seeded history, so re-processing everything already indexed would be wasted work, not
  // a correctness fix.
  let synthesisEmails = emailExtractions;
  let synthesisNotes = noteExtractions;
  if (mode === "update") {
    const stored = await loadStoredExtractions();
    synthesisEmails = stored.emails;
    synthesisNotes = stored.notes;
  }
  const synthesisContactProfiles = mode === "update" ? batchContacts(synthesisEmails) : contactProfiles;
  const notesByCategory = synthesisNotes.reduce((map, n) => {
    const arr = map.get(n.category) ?? [];
    arr.push(n);
    map.set(n.category, arr);
    return map;
  }, new Map<string, typeof synthesisNotes>());

  let parts: Omit<SynthesisResult, "fullContext"> = { contacts: "", tasks: "", keep: "", github: "" };
  let fullContext = "";

  // Which sources actually produced something this run. Kept as flags rather than re-derived from
  // the prose below, because the patch path has to tell "this source says nothing new" apart from
  // "this source was not fetched" - and on the server the latter is routine: GitHub needs a token
  // in .env and Keep needs the gkeepapi venv, and either being absent yields zero items, not an
  // error. Handing the resulting "No GitHub data" placeholder to synthesizePatch as a delta tells
  // the model the user's repos are gone, with nothing but "do not shrink the document" in the way.
  const fetched = {
    contacts: synthesisEmails.length > 0,
    tasks: taskItems.length > 0,
    keep: synthesisNotes.length > 0,
    github: githubRepos.length > 0,
  };

  try {
    const [contactsSummary, tasksSummary, keepSummary, githubSummary] = await Promise.allSettled([
      fetched.contacts ? synthesizeContacts(synthesisContactProfiles) : Promise.resolve("No email data"),
      fetched.tasks ? synthesizeTasks(taskItems) : Promise.resolve("No task data"),
      fetched.keep ? synthesizeKeep(notesByCategory) : Promise.resolve("No Keep data"),
      fetched.github ? synthesizeGitHub(githubRepos) : Promise.resolve("No GitHub data"),
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

    const previous = mode === "update" ? await loadPreviousDocument() : { context: "", itemsIndexed: 0 };

    if (previous.context) {
      const delta = Object.fromEntries(
        (Object.keys(fetched) as (keyof typeof fetched)[])
          .filter((k) => fetched[k] && parts[k])
          .map((k) => [k, parts[k]]),
      );
      fullContext = await synthesizePatch(
        previous.context,
        delta,
        {
          existing: previous.itemsIndexed,
          delta: emailExtractions.length + noteExtractions.length + githubRepos.length,
        },
        corrections,
      );

      // The patch replaces the document outright, so a reply that ignored the heading contract is
      // not a cosmetic problem: it is the whole long-term context gone. Rebuilding from the source
      // summaries costs one more synthesis call and always produces the five-section structure.
      const missing = missingSections(fullContext);
      if (missing.length > 0) {
        await logError(
          "phase:synthesis",
          `patched document is missing section(s) ${missing.join(", ")} - rebuilding it in full instead`,
        );
        fullContext = await synthesizeFullContext(parts, corrections);
      }
    } else {
      if (mode === "update") {
        console.warn("[Synthesis] no previous document worth patching - synthesising this one in full");
      }
      fullContext = await synthesizeFullContext(parts, corrections);
    }

    // A full build has the same contract to meet, and there is no second fallback left after it.
    const stillMissing = missingSections(fullContext);
    if (stillMissing.length > 0) {
      throw new Error(`synthesised document is missing section(s) ${stillMissing.join(", ")}`);
    }
  } catch (err) {
    await logError("phase:synthesis", err);
    // Whatever is in fullContext at this point did not pass, so it must not be handed on as though
    // it had. The output file still gets written - it holds the four source summaries and is worth
    // having - but the run records no output path, which keeps the last good harvest the newest
    // document the pipeline can find instead of quietly displacing it with an unreadable one.
    fullContext = "";
  }

  state.phases.synthesis.done = true;
  updateProgress(state);

  // === OUTPUT FILES ===
  let jsonPath = "";
  let mdPath = "";
  let document: ContextDocument | null = null;
  try {
    const paths = await writeOutputFiles(
      { ...parts, fullContext },
      config.outputDir,
      today,
    );
    jsonPath = paths.jsonPath;
    mdPath = paths.mdPath;
    document = paths.document;
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
    // No document unless synthesis actually produced one the pipeline can read. The column is
    // how every downstream reader finds the harvest, so recording a failed synthesis is worse
    // than recording nothing.
    const usable = fullContext ? document : null;
    await finalizeRun(dbRunId, {
      itemsIndexed: totalIndexed,
      outputPath: usable && jsonPath ? jsonPath : null,
      document: usable,
    });
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
