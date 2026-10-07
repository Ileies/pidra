/**
 * The one read path for notes that go into a model call or a search query. Each pipeline stage names
 * itself (`NoteStep`) and gets the live notes its scopes, `steps` and (when it has an item) `applies_to`
 * reach; no stage queries `notes` on its own.
 * Invariant (docs/architecture-rules.md): deleted, expired and not-yet-active notes never come back, and
 * a note is live from `active_from` through its expiry day. `selectNotes` records what it returned in
 * `note_loads` (`loads.ts`); a stage that filters per item itself records its own. Per-stage caps and character limits stay with
 * the caller. Matching is plain case-insensitive substring: no embeddings in the pipeline.
 */
import { and, asc, eq, gte, inArray, isNull, lte, notLike, or, sql, type SQL } from "drizzle-orm";
import { db, notes } from "../db";
import { recordLoads } from "./loads";
import { isTargeted } from "./narrowness";
import { NOTE_STEPS, PROPOSAL_PREFIX, STEP_SCOPES, type NoteStep, type NoteTargets } from "./steps";
import type { Note } from "./store";

/** What one stage input offers for `applies_to` matching. Items without a sender (calendar, tasks) leave `sender` out, so a `senders` target never matches them. */
export interface NoteItem {
  sender?: string | null;
  text?: string | null;
  entities?: string[];
}

const KEYS = ["senders", "entities", "keywords"] as const;

const clean = (list: string[] | undefined) => (list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);

export { isTargeted, NOTE_STEPS, PROPOSAL_PREFIX, type NoteStep, type NoteTargets };

/** An untargeted note matches every item. A targeted one needs every key it sets to match; without an item it never matches. */
export function matchesItem(targets: NoteTargets | null | undefined, item?: NoteItem): boolean {
  if (!isTargeted(targets)) return true;
  if (!item) return false;

  const sender = (item.sender ?? "").toLowerCase();
  const text = (item.text ?? "").toLowerCase();
  const entities = (item.entities ?? []).map((e) => e.toLowerCase());

  const senders = clean(targets?.senders);
  const wantedEntities = clean(targets?.entities);
  const keywords = clean(targets?.keywords);
  return (
    (senders.length === 0 || senders.some((s) => sender.includes(s))) &&
    (wantedEntities.length === 0 || wantedEntities.some((e) => text.includes(e) || entities.some((x) => x.includes(e)))) &&
    (keywords.length === 0 || keywords.some((k) => text.includes(k)))
  );
}

/** SQL condition: `step` can read the note, by scope, `steps` and the proposal exclusion. Says nothing about dates, deletion or targets. */
export function reachesStep(step: NoteStep): SQL {
  return and(
    inArray(notes.scope, [...STEP_SCOPES[step]]),
    or(eq(sql`cardinality(${notes.steps})`, 0), sql`${step} = any(${notes.steps})`),
    notLike(notes.content, `${PROPOSAL_PREFIX}%`),
  )!;
}

/** The notes of `step` that are live on `runDate`, targeted ones included, oldest first (`id` breaks ties). For a stage that filters per item itself, which then calls `recordLoads` with the notes it used; others call `selectNotes`. */
export async function selectStepNotes(step: NoteStep, runDate: string): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(and(
      reachesStep(step),
      isNull(notes.deletedAt),
      or(isNull(notes.activeFrom), lte(notes.activeFrom, runDate)),
      or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)),
    ))
    .orderBy(asc(notes.createdAt), asc(notes.id));
}

/** `rows` narrowed to the ones that apply to `item`; with no item, targeted notes drop out. */
export function notesForItem(rows: Note[], item?: NoteItem): Note[] {
  return rows.filter((n) => matchesItem(n.appliesTo, item));
}

/** Live notes for `step` on `runDate`. Pass the `item` the stage is about to process; a stage with no single item (Section 1 and 2, news, reconcile) passes none and so never loads targeted notes. */
export async function selectNotes(step: NoteStep, runDate: string, item?: NoteItem): Promise<Note[]> {
  const rows = notesForItem(await selectStepNotes(step, runDate), item);
  await recordLoads(step, runDate, rows);
  return rows;
}
