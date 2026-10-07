/**
 * How narrow a note is, derived from its fields and never stored: the four kinds /notes filters by and
 * `list_notes` accepts. Pure, so the dashboard's offline filter and the server's SQL (`filters.ts`) share
 * one definition. The kinds overlap: a note with a sender target and an expiry is both targeted and dated.
 */
import { PROPOSAL_PREFIX, STEP_SCOPES, type NoteStep } from "./steps";

/** Days without a load after which a note counts as dormant (the "not loaded lately" view). */
export const DORMANT_DAYS = 30;

export const NARROWNESS = ["always", "step", "targeted", "dated"] as const;
export type Narrowness = (typeof NARROWNESS)[number];

type Targets = Partial<Record<"senders" | "entities" | "keywords", string[]>>;

/** The fields narrowness reads; the row shape on either side maps onto it. */
export interface NarrowFields {
  steps: readonly string[];
  appliesTo: Targets | null | undefined;
  activeFrom: string | null | undefined;
  expiresAt: string | null | undefined;
}

/** Whether `applies_to` names at least one non-blank entry; an empty list counts as absent. */
export function isTargeted(targets: Targets | null | undefined): boolean {
  return Object.values(targets ?? {}).some((list) => (list ?? []).some((entry) => entry.trim() !== ""));
}

/** Every kind the note falls under; dates do not make a note narrower in where it loads, so a dated note with no steps or targets is both "always" and "dated". */
export function narrownessOf(note: NarrowFields): Narrowness[] {
  const targeted = isTargeted(note.appliesTo);
  const dated = !!note.activeFrom || !!note.expiresAt;
  const kinds: Narrowness[] = [];
  if (note.steps.length === 0 && !targeted) kinds.push("always");
  if (note.steps.length > 0 && !targeted) kinds.push("step");
  if (targeted) kinds.push("targeted");
  if (dated) kinds.push("dated");
  return kinds;
}

/** Whether `step` can read the note by scope, `steps` and the proposal exclusion; the JS twin of `reachesStep` in `select.ts`. */
export function reachesStepRow(note: { scope: string; steps: readonly string[]; content: string }, step: NoteStep): boolean {
  return STEP_SCOPES[step].includes(note.scope)
    && (note.steps.length === 0 || note.steps.includes(step))
    && !note.content.startsWith(PROPOSAL_PREFIX);
}
