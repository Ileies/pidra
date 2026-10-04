import { clearCheckpoint } from "../checkpoint";
import { logError } from "../errors";
import { stopProgress, updateProgress } from "../progress";
import { finalizeRun } from "../run-tracking";
import { batchContacts } from "../pipeline/batch-contacts";
import type { EmailExtraction } from "../pipeline/extract-email";
import type { NoteExtraction } from "../pipeline/extract-note";
import type { SynthesisResult } from "../pipeline/synthesize";
import { seedContacts, seedEntities, seedRuleNotes } from "../output/db-writer";
import { writeOutputFiles, type ContextDocument } from "../output/builder";
import type { RunCtx } from "./context";
import type { Fetched } from "./fetch";

/**
 * Seeds each target table independently: these three are the whole point of the run, and a
 * failure writing one must not silently skip the others (a transient error during the entity
 * batch used to leave rule notes unseeded with the run still reported complete).
 */
export async function runDbSeeding(
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

/** Writes the output files, seeds the target tables, records the run and clears the checkpoint. Returns the item count and the markdown path. */
export async function finalizePhase(
  ctx: RunCtx,
  fetched: Pick<Fetched, "taskItems" | "githubRepos">,
  extracted: { emailExtractions: EmailExtraction[]; noteExtractions: NoteExtraction[] },
  synthesis: { parts: Omit<SynthesisResult, "fullContext">; fullContext: string },
): Promise<{ totalIndexed: number; mdPath: string }> {
  const { state, config, dbRunId, today } = ctx;
  const { emailExtractions, noteExtractions } = extracted;

  let jsonPath = "";
  let mdPath = "";
  let document: ContextDocument | null = null;
  try {
    const paths = await writeOutputFiles({ ...synthesis.parts, fullContext: synthesis.fullContext }, config.outputDir, today);
    jsonPath = paths.jsonPath;
    mdPath = paths.mdPath;
    document = paths.document;
  } catch (err) {
    await logError("phase:output", err);
  }

  await runDbSeeding(batchContacts(emailExtractions), emailExtractions, noteExtractions);
  state.phases.dbSeed.done = true;
  updateProgress(state);

  const totalIndexed = emailExtractions.length + noteExtractions.length + fetched.githubRepos.length + fetched.taskItems.length;

  if (dbRunId) {
    // No document unless synthesis actually produced one the pipeline can read. The column is
    // how every downstream reader finds the harvest, so recording a failed synthesis is worse
    // than recording nothing.
    const usable = synthesis.fullContext ? document : null;
    await finalizeRun(dbRunId, {
      itemsIndexed: totalIndexed,
      outputPath: usable && jsonPath ? jsonPath : null,
      document: usable,
    });
  }

  await clearCheckpoint();
  stopProgress();
  return { totalIndexed, mdPath };
}
