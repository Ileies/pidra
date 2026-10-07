/**
 * The SQL side of the /notes and `list_notes` targeting filters (narrowness, step, target, dormant), as
 * conditions `listNotes` adds to its own. Narrowness mirrors `narrownessOf` in `narrowness.ts`.
 */
import { isNotNull, or, sql, type SQL } from "drizzle-orm";
import { notes } from "../db";
import { NoteError } from "./errors";
import { loadedRecently } from "./loads";
import { NARROWNESS, type Narrowness } from "./narrowness";
import { NOTE_STEPS, reachesStep, type NoteStep } from "./select";

export interface TargetingFilters {
  /** One of `NARROWNESS`. */
  narrowness?: string;
  /** Notes that step can read (scope and `steps`), whatever their targets. */
  step?: string;
  /** Case-insensitive substring of any sender, entity or keyword the note targets. */
  target?: string;
  /** Only notes with no load in the last 30 days. */
  dormant?: boolean;
}

const targeted = sql`(${notes.appliesTo} is not null and ${notes.appliesTo} <> '{}'::jsonb)`;

const NARROWNESS_SQL: Record<Narrowness, SQL> = {
  always: sql`(cardinality(${notes.steps}) = 0 and not ${targeted})`,
  step: sql`(cardinality(${notes.steps}) > 0 and not ${targeted})`,
  targeted,
  dated: or(isNotNull(notes.activeFrom), isNotNull(notes.expiresAt))!,
};

export function targetingConditions(opts: TargetingFilters): SQL[] {
  const out: SQL[] = [];

  if (opts.narrowness) {
    const kind = opts.narrowness.trim().toLowerCase() as Narrowness;
    if (!NARROWNESS.includes(kind)) throw new NoteError(`narrowness must be one of ${NARROWNESS.join(", ")}`);
    out.push(NARROWNESS_SQL[kind]);
  }

  if (opts.step) {
    const step = opts.step.trim().toLowerCase();
    if (!(NOTE_STEPS as readonly string[]).includes(step)) throw new NoteError(`step must be one of ${NOTE_STEPS.join(", ")}`);
    out.push(reachesStep(step as NoteStep));
  }

  const target = opts.target?.trim();
  if (target) {
    out.push(sql`exists (
      select 1 from jsonb_each(coalesce(${notes.appliesTo}, '{}'::jsonb)) e, jsonb_array_elements_text(e.value) v
      where v ilike ${`%${target.replace(/[\\%_]/g, "\\$&")}%`}
    )`);
  }

  if (opts.dormant) out.push(sql`not ${loadedRecently(notes.id)}`);
  return out;
}
