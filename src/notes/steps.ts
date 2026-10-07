/**
 * The pipeline steps a note can be bound to, and the `applies_to` shape. Pure and import-free so the
 * dashboard can use the same list; `select.ts` re-exports both and owns what each step reads.
 */

export const NOTE_STEPS = ["classify", "section1", "section2", "news", "actions", "reconcile", "search"] as const;
export type NoteStep = (typeof NOTE_STEPS)[number];

/** The `applies_to` shape: keys AND-combine, entries within a key OR-match. An empty list counts as absent. */
export interface NoteTargets {
  /** Substring of the sender: an address, a domain or a phone number. */
  senders?: string[];
  /** Substring of the item text or one of its entity names. */
  entities?: string[];
  /** Substring of the item text. */
  keywords?: string[];
}

/**
 * Start of the weekly meta-run's prompt-diff note. It is for the reader to review on /notes, never an
 * instruction, so no step loads a note that starts with it.
 */
export const PROPOSAL_PREFIX = "WEEKLY META-RUN PROMPT DIFF PROPOSAL";

/** Which scopes each step reads. `global` holds the weekly meta-run's prompt proposals, so the news and actions steps leave it out. */
export const STEP_SCOPES: Record<NoteStep, readonly string[]> = {
  classify: ["personal", "contact", "global"],
  section1: ["intel", "global"],
  section2: ["personal", "global"],
  news: ["intel"],
  actions: ["personal"],
  reconcile: ["personal", "contact"],
  search: ["search"],
};
