/**
 * Validation, parsing and display of a note's targeting (`steps`, `applies_to`) for `store.ts` and the
 * note skills. The matching itself lives in `select.ts`; this only decides what gets stored.
 */
import { NoteError } from "./errors";
import { NOTE_STEPS, type NoteStep, type NoteTargets } from "./select";

export const TARGET_KEYS = ["senders", "entities", "keywords"] as const;

/** Lower-cased, de-duplicated and checked against `NOTE_STEPS`. */
export function normaliseSteps(steps: string[]): NoteStep[] {
  const wanted = steps.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  for (const step of wanted) {
    if (!(NOTE_STEPS as readonly string[]).includes(step)) throw new NoteError(`steps must be one of ${NOTE_STEPS.join(", ")}`);
  }
  return [...new Set(wanted)] as NoteStep[];
}

/** Trims, de-duplicates and drops empty entries; null when nothing is left, so "untargeted" has one stored form. */
export function normaliseTargets(targets: NoteTargets | null): NoteTargets | null {
  if (!targets) return null;
  for (const key of Object.keys(targets)) {
    if (!(TARGET_KEYS as readonly string[]).includes(key)) throw new NoteError(`applies_to takes only ${TARGET_KEYS.join(", ")}`);
  }
  const out: NoteTargets = {};
  for (const key of TARGET_KEYS) {
    const list = targets[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new NoteError(`applies_to.${key} must be a list of strings`);
    const cleaned = [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
    if (cleaned.some((v) => v.length > 100) || cleaned.length > 20) throw new NoteError(`applies_to.${key} takes at most 20 entries of 100 characters`);
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A comma-separated skill parameter as a list; "none" (or empty) is the empty list. */
export function listFromText(value: unknown): string[] {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "none") return [];
  return text.split(",").map((v) => v.trim()).filter(Boolean);
}

/** The flat `senders` / `entities` / `keywords` skill parameters as one `applies_to`; undefined when none was passed. */
export function targetsFromParams(params: Record<string, unknown>): NoteTargets | undefined {
  const given = TARGET_KEYS.filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "");
  if (given.length === 0) return undefined;
  return Object.fromEntries(given.map((k) => [k, listFromText(params[k])]));
}

/** Structural equality with null and undefined alike, for "did this edit change anything". */
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** `only for senders: a, b; keywords: c`, or null for an untargeted note. */
export function describeTargets(targets: NoteTargets | null): string | null {
  const parts = TARGET_KEYS.filter((k) => targets?.[k]?.length).map((k) => `${k}: ${targets![k]!.join(", ")}`);
  return parts.length > 0 ? `only for ${parts.join("; ")}` : null;
}
