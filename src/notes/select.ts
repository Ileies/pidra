/**
 * The one read path for notes that go into a model call or a search query. Each pipeline stage names
 * itself (`NoteStep`) and gets the live notes its scopes reach; no stage queries `notes` on its own.
 * Invariant (docs/architecture-rules.md): deleted and expired notes never come back, and a note is
 * live through its expiry day. Per-stage caps and character limits stay with the caller.
 */
import { and, asc, gte, inArray, isNull, or } from "drizzle-orm";
import { db, notes } from "../db";
import type { Note, NoteScope } from "./store";

export type NoteStep = "classify" | "section1" | "section2" | "news" | "actions" | "reconcile" | "search";

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

/** Live notes for `step` on `runDate`, oldest first (`id` breaks ties), so the order is stable between runs. */
export async function selectNotes(step: NoteStep, runDate: string): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(and(
      inArray(notes.scope, [...STEP_SCOPES[step]]),
      isNull(notes.deletedAt),
      or(isNull(notes.expiresAt), gte(notes.expiresAt, runDate)),
    ))
    .orderBy(asc(notes.createdAt), asc(notes.id));
}
