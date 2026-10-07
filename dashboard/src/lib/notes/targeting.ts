/**
 * Draft, patch and display helpers for a note's targeting (steps, senders/entities/keywords, start day).
 * The server validates and normalises; this only converts between what the editor holds and the API shape.
 */
import type { NoteTargets } from "$pipeline/notes/steps";
import { DORMANT_DAYS } from "$pipeline/notes/narrowness";
import type { Draft, NoteRow, NotePatch } from "#lib/notes/api.js";

export const TARGET_FIELDS = [
  { key: "senders", label: "Senders", hint: "Names, addresses or domains, e.g. netcup" },
  { key: "entities", label: "Entities", hint: "People or companies mentioned in the item" },
  { key: "keywords", label: "Keywords", hint: "Words that must appear in the item" },
] as const;

/** What each step does with a note, for the editor's chips. */
export const STEP_HINT: Record<string, string> = {
  classify: "Sorting each personal mail",
  section1: "Writing the intelligence section",
  section2: "Writing the personal section",
  news: "The news desks",
  actions: "Proposing quick actions",
  reconcile: "Updating the questions queue",
  search: "The daily monitoring web search",
};

const toList = (text: string) => [...new Set(text.split(",").map((v) => v.trim()).filter(Boolean))];
const toText = (list: string[] | undefined) => (list ?? []).join(", ");

/** The `applies_to` an editor draft describes; null when no list has an entry. */
export function targetsOf(draft: Pick<Draft, "senders" | "entities" | "keywords">): NoteTargets | null {
  const out: NoteTargets = {};
  for (const { key } of TARGET_FIELDS) {
    const list = toList(draft[key]);
    if (list.length > 0) out[key] = list;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The targeting part of a draft, from a stored note or empty for a new one. */
export function draftTargeting(note?: NoteRow): Pick<Draft, "activeFrom" | "steps" | "senders" | "entities" | "keywords"> {
  return {
    activeFrom: note?.active_from ?? "",
    steps: [...(note?.steps ?? [])],
    senders: toText(note?.applies_to?.senders),
    entities: toText(note?.applies_to?.entities),
    keywords: toText(note?.applies_to?.keywords),
  };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The targeting fields of `draft` that differ from `note`, in `NotePatch` shape, so an edit that leaves targeting alone sends none of it. */
export function targetingPatch(note: NoteRow, draft: Draft): NotePatch {
  const patch: NotePatch = {};
  const steps = [...draft.steps].sort();
  if (!sameList(steps, [...note.steps].sort())) patch.steps = steps;

  const targets = targetsOf(draft);
  if (JSON.stringify(targets) !== JSON.stringify(targetsOf(draftTargeting(note)))) patch.applies_to = targets;

  if ((draft.activeFrom || null) !== (note.active_from ?? null)) patch.active_from = draft.activeFrom || null;
  return patch;
}

/** Short chips for a card: where the note loads and who it is for. Empty for a note that loads everywhere. */
export function targetingBadges(note: Pick<NoteRow, "steps" | "applies_to" | "active_from">): { text: string; title: string }[] {
  const out: { text: string; title: string }[] = [];
  if (note.steps.length > 0) out.push({ text: note.steps.join(", "), title: "Loads only in these steps" });
  for (const { key, label } of TARGET_FIELDS) {
    const list = note.applies_to?.[key] ?? [];
    if (list.length > 0) out.push({ text: `${label.toLowerCase()}: ${list.join(", ")}`, title: `Loads only for items matching these ${label.toLowerCase()}` });
  }
  if (note.active_from) out.push({ text: `from ${note.active_from}`, title: "Starts applying on this day" });
  return out;
}

/** Whether the note went into no model call in the last `DORMANT_DAYS` days. */
export function isDormant(note: Pick<NoteRow, "last_loaded_on">, today: string): boolean {
  if (!note.last_loaded_on) return true;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - DORMANT_DAYS);
  return note.last_loaded_on < cutoff.toISOString().slice(0, 10);
}
