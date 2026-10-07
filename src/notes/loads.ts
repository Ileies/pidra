/**
 * Which notes actually went into a model call or search, per step and run day, so /notes can show a
 * note that never loads (a too-narrow target is otherwise silent). The only writer of `note_loads`.
 * Recording never throws: a failed write must not fail the pipeline stage that read the notes.
 */
import { inArray, sql } from "drizzle-orm";
import { db, noteLoads } from "../db";
import { addDays, utcDay } from "../util/time";
import { DORMANT_DAYS } from "./narrowness";
import type { NoteStep } from "./select";

export interface LoadStats {
  /** Distinct step and run-day pairs the note was loaded in. */
  count: number;
  /** Latest run day, `YYYY-MM-DD`. */
  last: string;
}

/** Marks `notes` as loaded by `step` on `runDate`. Idempotent per note, step and day, so a rerun does not inflate the count. */
export async function recordLoads(step: NoteStep, runDate: string, notes: { id: string }[]): Promise<void> {
  if (notes.length === 0) return;
  try {
    await db
      .insert(noteLoads)
      .values(notes.map((n) => ({ noteId: n.id, step, runDate })))
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[notes] could not record note loads:", err);
  }
}

/** Load history for `ids`; a note that never loaded has no entry. */
export async function loadStatsFor(ids: string[]): Promise<Map<string, LoadStats>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: noteLoads.noteId, count: sql<number>`count(*)::int`, last: sql<string>`max(${noteLoads.runDate})::text` })
    .from(noteLoads)
    .where(inArray(noteLoads.noteId, ids))
    .groupBy(noteLoads.noteId);
  return new Map(rows.map((r) => [r.id, { count: r.count, last: r.last }]));
}

/** SQL condition: the note has a load row on or after the dormancy cutoff. `id` is the notes id column. */
export const loadedRecently = (id: unknown, today = utcDay()) =>
  sql`exists (select 1 from ${noteLoads} l where l.note_id = ${id} and l.run_date >= ${addDays(today, -DORMANT_DAYS)}::date)`;
