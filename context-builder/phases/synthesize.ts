// Phase 3 (called by run.ts): four source summaries, then the long-term document, either as a patch
// of the previous one (update mode) or built in full. The document must keep the `# 1.` to `# 5.`
// headings (see missingSections in run-tracking.ts); a document that fails the check is dropped.
import { logError } from "../errors";
import { updateProgress } from "../progress";
import { loadPreviousDocument, loadStoredExtractions, missingSections } from "../run-tracking";
import { batchContacts } from "../pipeline/batch-contacts";
import type { EmailExtraction } from "../pipeline/extract-email";
import type { NoteExtraction } from "../pipeline/extract-note";
import {
  synthesizeContacts,
  synthesizeTasks,
  synthesizeKeep,
  synthesizeGitHub,
  synthesizeFullContext,
  synthesizePatch,
  type SynthesisResult,
} from "../pipeline/synthesize";
import { listActiveCorrections, formatForPrompt } from "../../src/context/corrections";
import type { RunCtx } from "./context";
import type { Fetched } from "./fetch";

/**
 * Writes the four source summaries and the long-term document from them. Always runs, with
 * whatever data is available; a failed synthesis leaves `fullContext` empty so it is never handed
 * on as though it had passed.
 */
export async function synthesizePhase(
  ctx: RunCtx,
  fetched: Pick<Fetched, "taskItems" | "githubRepos">,
  extracted: { emailExtractions: EmailExtraction[]; noteExtractions: NoteExtraction[] },
): Promise<{ parts: Omit<SynthesisResult, "fullContext">; fullContext: string }> {
  const { mode, state } = ctx;
  const { taskItems, githubRepos } = fetched;

  // In update mode the Contacts/Keep summaries must come from the full stored corpus, not today's
  // delta, or they collapse to whatever changed (2026-09-11: the Keep section shrank from 641 to
  // 71 lines off a single-note delta). Tasks and GitHub are always fetched in full, so only email
  // and Keep need this. DB seeding (finalize.ts) stays delta-only: its upserts are idempotent
  // against already-seeded history.
  const corpus = mode === "update" ? await loadStoredExtractions() : { emails: extracted.emailExtractions, notes: extracted.noteExtractions };
  const synthesisEmails = corpus.emails;
  const synthesisNotes = corpus.notes;
  const synthesisContactProfiles = batchContacts(synthesisEmails);
  const notesByCategory = synthesisNotes.reduce((map, n) => {
    const arr = map.get(n.category) ?? [];
    arr.push(n);
    map.set(n.category, arr);
    return map;
  }, new Map<string, typeof synthesisNotes>());

  let parts: Omit<SynthesisResult, "fullContext"> = { contacts: "", tasks: "", keep: "", github: "" };
  let fullContext = "";

  // Which sources produced anything this run. Flags, not derived from the summary prose, because
  // the patch must tell "nothing new" from "not fetched" (routine on the server: GitHub needs a
  // token, Keep needs the gkeepapi venv, and absence yields zero items, not an error). Passing a
  // "No GitHub data" placeholder to synthesizePatch would tell the model the repos are gone.
  const fetchedFlags = {
    contacts: synthesisEmails.length > 0,
    tasks: taskItems.length > 0,
    keep: synthesisNotes.length > 0,
    github: githubRepos.length > 0,
  };

  try {
    const [contactsSummary, tasksSummary, keepSummary, githubSummary] = await Promise.allSettled([
      fetchedFlags.contacts ? synthesizeContacts(synthesisContactProfiles) : Promise.resolve("No email data"),
      fetchedFlags.tasks ? synthesizeTasks(taskItems) : Promise.resolve("No task data"),
      fetchedFlags.keep ? synthesizeKeep(notesByCategory) : Promise.resolve("No Keep data"),
      fetchedFlags.github ? synthesizeGitHub(githubRepos) : Promise.resolve("No GitHub data"),
    ]);

    parts = {
      contacts: contactsSummary.status === "fulfilled" ? contactsSummary.value : "",
      tasks: tasksSummary.status === "fulfilled" ? tasksSummary.value : "",
      keep: keepSummary.status === "fulfilled" ? keepSummary.value : "",
      github: githubSummary.status === "fulfilled" ? githubSummary.value : "",
    };

    // Read-only prompt input: without it a rebuild or patch reinstates mistakes the user already
    // corrected. Corrections are never written here and outrank the harvested text.
    const corrections = formatForPrompt(await listActiveCorrections());
    if (corrections.length > 0) {
      console.log(`[Synthesis] ${corrections.length} active correction(s) injected`);
    }

    const previous = mode === "update" ? await loadPreviousDocument() : { context: "", itemsIndexed: 0 };

    if (previous.context) {
      const delta = Object.fromEntries(
        (Object.keys(fetchedFlags) as (keyof typeof fetchedFlags)[])
          .filter((k) => fetchedFlags[k] && parts[k])
          .map((k) => [k, parts[k]]),
      );
      fullContext = await synthesizePatch(
        previous.context,
        delta,
        {
          existing: previous.itemsIndexed,
          delta: extracted.emailExtractions.length + extracted.noteExtractions.length + githubRepos.length,
        },
        corrections,
      );

      // The patch replaces the document outright, so a reply that broke the `# 1.`-`# 5.` contract
      // would wipe the long-term context. Rebuild in full (one more call) instead.
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

    // A full build must meet the same contract; there is no fallback after it, so throw.
    const stillMissing = missingSections(fullContext);
    if (stillMissing.length > 0) {
      throw new Error(`synthesised document is missing section(s) ${stillMissing.join(", ")}`);
    }
  } catch (err) {
    await logError("phase:synthesis", err);
    // Empty fullContext means "failed": finalize.ts still writes the output files (the four summaries
    // are worth keeping) but records no document, so the last good harvest stays the newest one.
    fullContext = "";
  }

  state.phases.synthesis.done = true;
  updateProgress(state);
  return { parts, fullContext };
}
