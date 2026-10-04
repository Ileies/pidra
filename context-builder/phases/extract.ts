import { saveCheckpoint } from "../checkpoint";
import { updateProgress } from "../progress";
import { extractEmails, type EmailExtraction } from "../pipeline/extract-email";
import { extractNotes, type NoteExtraction } from "../pipeline/extract-note";
import { safePhase, type RunCtx } from "./context";
import type { Fetched } from "./fetch";

/** Extracts the new mails and Keep notes, on top of what a resumed run already had. A failure keeps what was extracted so far in the index. */
export async function extractPhase(
  ctx: RunCtx,
  fetched: Pick<Fetched, "emailItems" | "keepNotes" | "keepSkipSet">,
  prior: { emails: EmailExtraction[]; notes: NoteExtraction[] },
): Promise<{ emailExtractions: EmailExtraction[]; noteExtractions: NoteExtraction[] }> {
  const { state, dbRunId, today } = ctx;

  const emailExtractions = [...prior.emails];
  await safePhase("email-extract", undefined, async () => {
    if (fetched.emailItems.length === 0) return;
    emailExtractions.push(...await extractEmails(fetched.emailItems, dbRunId!, today, (done) => {
      state.phases.email.processed = prior.emails.length + done;
      updateProgress(state);
    }));
  });
  state.phases.email.done = true;
  await saveCheckpoint(state);
  updateProgress(state);

  const noteExtractions = [...prior.notes];
  await safePhase("keep-extract", undefined, async () => {
    if (fetched.keepNotes.length === 0) return;
    noteExtractions.push(...await extractNotes(fetched.keepNotes, dbRunId!, fetched.keepSkipSet, (done) => {
      state.phases.keep.processed = prior.notes.length + done;
      updateProgress(state);
    }));
  });
  state.phases.keep.done = true;
  await saveCheckpoint(state);
  updateProgress(state);

  return { emailExtractions, noteExtractions };
}
