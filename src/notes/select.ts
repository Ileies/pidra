/**
 * The one read path for notes that go into a model call or a search query. Each pipeline stage names
 * itself (`NoteStep`) and gets the live notes its scopes, `steps` and (when it has an item) `applies_to`
 * reach; no stage queries `notes` on its own.
 * Invariant (docs/architecture-rules.md): deleted, expired and not-yet-active notes never come back, and
 * a note is live from `active_from` through its expiry day. Per-stage caps and character limits stay with
 * the caller. Matching is plain case-insensitive substring: no embeddings in the pipeline.
 */
import { and, asc, eq, gte, inArray, isNull, lte, notLike, or, sql } from "drizzle-orm";
import { db, notes } from "../db";
import type { Note, NoteScope } from "./store";

export const NOTE_STEPS = ["classify", "section1", "section2", "news", "actions", "reconcile", "search"] as const;
export type NoteStep = (typeof NOTE_STEPS)[number];

/**
 * Start of the weekly meta-run's prompt-diff note. It is for the reader to review on /notes, never an
 * instruction, so no step loads a note that starts with it.
 */
export const PROPOSAL_PREFIX = "WEEKLY META-RUN PROMPT DIFF PROPOSAL";

/** The `applies_to` shape: keys AND-combine, entries within a key OR-match. An empty list counts as absent. */
export interface NoteTargets {
  /** Substring of the sender: an address, a domain or a phone number. */
  senders?: string[];
  /** Substring of the item text or one of its entity names. */
  entities?: string[];
  /** Substring of the item text. */
  keywords?: string[];
}

/** What one stage input offers for `applies_to` matching. Items without a sender (calendar, tasks) leave `sender` out, so a `senders` target never matches them. */
export interface NoteItem {
  sender?: string | null;
  text?: string | null;
  entities?: string[];
}

/** Which scopes each step reads. `global` holds the weekly meta-run's prompt proposals, so the news and actions steps leave it out. */
const STEP_SCOPES: Record<NoteStep, readonly NoteScope[]> = {
  classify: ["personal", "contact", "global"],
  section1: ["intel", "global"],
  section2: ["personal", "global"],
  news: ["intel"],
  actions: ["personal"],
  reconcile: ["personal", "contact"],
  search: ["search"],
};

const KEYS = ["senders", "entities", "keywords"] as const;

const clean = (list: string[] | undefined) => (list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Whether the note narrows itself to particular items at all. */
export function isTargeted(targets: NoteTargets | null | undefined): boolean {
  return KEYS.some((key) => clean(targets?.[key]).length > 0);
}

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

/** The notes of `step` that are live on `runDate`, targeted ones included, oldest first (`id` breaks ties). For a stage that filters per item itself; others call `selectNotes`. */
export async function selectStepNotes(step: NoteStep, runDate: string): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(and(
      inArray(notes.scope, [...STEP_SCOPES[step]]),
      isNull(notes.deletedAt),
      or(isNull(notes.activeFrom), lte(notes.activeFrom, runDate)),
      or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)),
      or(eq(sql`cardinality(${notes.steps})`, 0), sql`${step} = any(${notes.steps})`),
      notLike(notes.content, `${PROPOSAL_PREFIX}%`),
    ))
    .orderBy(asc(notes.createdAt), asc(notes.id));
}

/** `rows` narrowed to the ones that apply to `item`; with no item, targeted notes drop out. */
export function notesForItem(rows: Note[], item?: NoteItem): Note[] {
  return rows.filter((n) => matchesItem(n.appliesTo, item));
}

/** Live notes for `step` on `runDate`. Pass the `item` the stage is about to process; a stage with no single item (Section 1 and 2, news, reconcile) passes none and so never loads targeted notes. */
export async function selectNotes(step: NoteStep, runDate: string, item?: NoteItem): Promise<Note[]> {
  return notesForItem(await selectStepNotes(step, runDate), item);
}
