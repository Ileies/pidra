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

  // The standalone Contacts/Keep sections - and the "new information" handed to synthesizePatch -
  // must reflect the full current corpus in update mode, not just today's delta, or they collapse
  // to whatever changed today (2026-09-11: "Personal Knowledge (Keep)" shrank from 641 to 71 lines
  // off a single-note delta, and the Contacts Summary's low-importance breakdown vanished). Tasks
  // and GitHub don't have this problem since they're always refetched in full; email and Keep need
  // it explicitly because their fetch is delta-only via the skip-set. DB seeding stays on the
  // delta-only sets - seedContacts/seedEntities/seedRuleNotes are upserts against already-seeded
  // history, so re-processing everything already indexed would be wasted work, not a correctness fix.
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

  // Which sources actually produced something this run. Kept as flags rather than re-derived from
  // the prose below, because the patch path has to tell "this source says nothing new" apart from
  // "this source was not fetched" - and on the server the latter is routine: GitHub needs a token
  // in .env and Keep needs the gkeepapi venv, and either being absent yields zero items, not an
  // error. Handing the resulting "No GitHub data" placeholder to synthesizePatch as a delta tells
  // the model the user's repos are gone, with nothing but "do not shrink the document" in the way.
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
  return { parts, fullContext };
}
