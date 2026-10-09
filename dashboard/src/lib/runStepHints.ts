/**
 * One-sentence explanations for the steps whose name alone does not say what they do, shown as a
 * hover hint in the run's "Details" list. Self-explaining steps (feeds, mailboxes, desks, sections)
 * are left out on purpose. Keys are step ids as the pipeline records them (see `STEP_LABELS` in `runTrace.ts`).
 */

const HINTS: Record<string, string> = {
  "news:repeat-judge": "Compares the candidate stories with ones already reported and drops repeats.",
  "news:jev-shadow": "Scores stories with Jev in shadow mode. Nothing it produces reaches the report.",
  phase2: "Compresses the raw items into structured JSON for synthesis.",
  phase3: "Gathers long-term context and standing rules for synthesis.",
  "phase3-websearch": "The web search slots that look up the day's topics.",
  phase4: "Reconciles the questions this run raised with the open queue.",
  "phase4-review": "Absorbs answers given to review questions.",
  "phase4-questions": "Reconciles the question queue.",
  "phase4-wait": "Section 2 waits for answers to this run's questions, up to the timeout.",
  "phase5-section1": "Writes the newsletter digest, ranked against your priorities.",
  "phase5-section2": "Writes the personal part: email, calendar, tasks and SMS, with urgency labels.",
  "phase5-news": "The news editor assembles the desks' stories into the News section.",
  "phase5-actions": "Derives the quick actions offered with the report.",
  phase6: "Updates entities, source trust and other long-term state from the run.",
};

/** A short explanation for a step, or null when its name already says enough. */
export function stepHint(step: string): string | null {
  return HINTS[step] ?? null;
}
