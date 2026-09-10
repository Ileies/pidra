import { and, asc, desc, eq, ilike, isNotNull, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, notes, noteRevisions } from "../db";

/**
 * The only writer of `notes` and `note_revisions`.
 *
 * `notes` is the mutable working layer - the user's standing instructions plus whatever Phase 6
 * writes from the `<!--SYSTEM-->` block - so unlike the harvested long-term context it is edited
 * in place. What makes that safe is here rather than in the callers: every mutation appends the
 * pre-change state to `note_revisions`, and a delete only sets `deleted_at`. The dashboard's
 * write endpoints and the note skills both come through this module, so a UI edit and a chat edit
 * cannot behave differently or skip the history.
 *
 * See ASSISTANT_PLAN.md. The harvested-context counterpart is `src/context/corrections.ts`.
 */

export const NOTE_SCOPES = ["global", "intel", "personal", "contact", "search"] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

export type Note = typeof notes.$inferSelect;
export type NoteRevision = typeof noteRevisions.$inferSelect;

export class NoteError extends Error {}

/** Who is making the change, and what to point the revision back at. */
export interface Actor {
  by: "user" | "chat" | "system";
  skillExecutionId?: string | null;
  conversationId?: string | null;
}

export interface NoteWrite {
  content?: string;
  scope?: string;
  /** `null` clears the expiry; omitted leaves it untouched. */
  expiresAt?: string | null;
}

export interface ListOptions {
  scope?: string;
  /** Substring match on content. */
  query?: string;
  /** `active` (default) hides soft-deleted notes, `deleted` shows only those, `all` shows both. */
  include?: "active" | "deleted" | "all";
  sort?: "newest" | "oldest" | "edited";
  limit?: number;
}

const UUID = /^[0-9a-f-]{36}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function assertUuid(id: string, label = "note_id"): string {
  const value = (id ?? "").trim();
  if (!UUID.test(value)) throw new NoteError(`${label} must be a UUID`);
  return value;
}

function normaliseScope(scope: string): NoteScope {
  const value = (scope ?? "").trim().toLowerCase();
  if (!NOTE_SCOPES.includes(value as NoteScope)) {
    throw new NoteError(`scope must be one of ${NOTE_SCOPES.join(", ")}`);
  }
  return value as NoteScope;
}

function normaliseExpiry(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!DATE_ONLY.test(trimmed)) throw new NoteError("expires_at must be a date as YYYY-MM-DD");
  return trimmed;
}

export async function listNotes(opts: ListOptions = {}): Promise<Note[]> {
  const filters = [];

  if (opts.include === "deleted") filters.push(isNotNull(notes.deletedAt));
  else if (opts.include !== "all") filters.push(isNull(notes.deletedAt));

  if (opts.scope) filters.push(eq(notes.scope, normaliseScope(opts.scope)));

  const query = opts.query?.trim();
  if (query) filters.push(ilike(notes.content, `%${query}%`));

  const order = opts.sort === "oldest"
    ? asc(notes.createdAt)
    : opts.sort === "edited"
      ? desc(drizzleSql`coalesce(${notes.updatedAt}, ${notes.createdAt})`)
      : desc(notes.createdAt);

  return db
    .select()
    .from(notes)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(order)
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));
}

export async function getNote(id: string): Promise<Note | null> {
  const [row] = await db.select().from(notes).where(eq(notes.id, assertUuid(id))).limit(1);
  return row ?? null;
}

export async function createNote(input: NoteWrite & { content: string }, actor: Actor): Promise<Note> {
  const content = (input.content ?? "").trim();
  if (!content) throw new NoteError("content is required");

  const [row] = await db
    .insert(notes)
    .values({
      content,
      scope: normaliseScope(input.scope ?? "global"),
      expiresAt: input.expiresAt === undefined ? null : normaliseExpiry(input.expiresAt),
      // Provenance of the *creation*, and never rewritten afterwards. A later edit only sets
      // `updated_by`, so a Phase 6 note the user fixed still reads as pipeline-written.
      createdBy: actor.by,
    })
    .returning();

  return row;
}

/**
 * In-place edit with the previous state appended to the history. An edit that changes nothing is
 * a no-op rather than an empty revision, so a model re-issuing the same call does not litter it.
 */
export async function updateNote(id: string, patch: NoteWrite, actor: Actor): Promise<Note> {
  const noteId = assertUuid(id);

  const nextContent = patch.content === undefined ? undefined : patch.content.trim();
  if (nextContent !== undefined && !nextContent) throw new NoteError("content cannot be emptied");
  const nextScope = patch.scope === undefined ? undefined : normaliseScope(patch.scope);
  const touchesExpiry = "expiresAt" in patch;
  const nextExpiry = touchesExpiry ? normaliseExpiry(patch.expiresAt ?? null) : undefined;

  if (nextContent === undefined && nextScope === undefined && !touchesExpiry) {
    throw new NoteError("nothing to update: pass content, scope or expires_at");
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(notes).where(eq(notes.id, noteId)).limit(1);
    if (!current) throw new NoteError(`note ${noteId} not found`);
    if (current.deletedAt) throw new NoteError(`note ${noteId} is deleted - restore it first`);

    const unchanged =
      (nextContent === undefined || nextContent === current.content) &&
      (nextScope === undefined || nextScope === current.scope) &&
      (!touchesExpiry || (nextExpiry ?? null) === (current.expiresAt ?? null));
    if (unchanged) return current;

    await tx.insert(noteRevisions).values({
      noteId,
      operation: "update",
      previousContent: current.content,
      previousScope: current.scope,
      previousExpiresAt: current.expiresAt,
      changedBy: actor.by,
      skillExecutionId: actor.skillExecutionId ?? null,
      conversationId: actor.conversationId ?? null,
    });

    const [row] = await tx
      .update(notes)
      .set({
        ...(nextContent === undefined ? {} : { content: nextContent }),
        ...(nextScope === undefined ? {} : { scope: nextScope }),
        ...(touchesExpiry ? { expiresAt: nextExpiry ?? null } : {}),
        updatedAt: drizzleSql`now()`,
        updatedBy: actor.by,
      })
      .where(eq(notes.id, noteId))
      .returning();

    return row;
  });
}

/**
 * Soft delete. This is why `delete_note` can stay a low-risk skill: nothing is lost, the note
 * leaves the briefing payload immediately, and the UI offers an undo.
 */
export async function softDeleteNote(id: string, actor: Actor): Promise<Note> {
  const noteId = assertUuid(id);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(notes).where(eq(notes.id, noteId)).limit(1);
    if (!current) throw new NoteError(`note ${noteId} not found`);
    if (current.deletedAt) return current;

    await tx.insert(noteRevisions).values({
      noteId,
      operation: "delete",
      previousContent: current.content,
      previousScope: current.scope,
      previousExpiresAt: current.expiresAt,
      changedBy: actor.by,
      skillExecutionId: actor.skillExecutionId ?? null,
      conversationId: actor.conversationId ?? null,
    });

    const [row] = await tx
      .update(notes)
      .set({ deletedAt: drizzleSql`now()`, updatedAt: drizzleSql`now()`, updatedBy: actor.by })
      .where(eq(notes.id, noteId))
      .returning();

    return row;
  });
}

export async function restoreNote(id: string, actor: Actor): Promise<Note> {
  const noteId = assertUuid(id);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(notes).where(eq(notes.id, noteId)).limit(1);
    if (!current) throw new NoteError(`note ${noteId} not found`);
    if (!current.deletedAt) return current;

    await tx.insert(noteRevisions).values({
      noteId,
      operation: "restore",
      previousContent: current.content,
      previousScope: current.scope,
      previousExpiresAt: current.expiresAt,
      changedBy: actor.by,
      skillExecutionId: actor.skillExecutionId ?? null,
      conversationId: actor.conversationId ?? null,
    });

    const [row] = await tx
      .update(notes)
      .set({ deletedAt: null, updatedAt: drizzleSql`now()`, updatedBy: actor.by })
      .where(eq(notes.id, noteId))
      .returning();

    return row;
  });
}

export async function noteHistory(id: string): Promise<NoteRevision[]> {
  return db
    .select()
    .from(noteRevisions)
    .where(eq(noteRevisions.noteId, assertUuid(id)))
    .orderBy(desc(noteRevisions.createdAt));
}

/**
 * Roll a note back to the state a revision recorded. The rollback is itself an edit, so it lands
 * in the history too and can be rolled back in turn - the history only ever grows.
 */
export async function revertToRevision(revisionId: string, actor: Actor): Promise<Note> {
  const id = assertUuid(revisionId, "revision_id");

  const [revision] = await db.select().from(noteRevisions).where(eq(noteRevisions.id, id)).limit(1);
  if (!revision) throw new NoteError(`revision ${id} not found`);
  if (revision.previousContent === null) {
    throw new NoteError("this revision holds no previous content to restore");
  }

  const note = await getNote(revision.noteId);
  if (!note) throw new NoteError(`note ${revision.noteId} not found`);
  if (note.deletedAt) await restoreNote(revision.noteId, actor);

  return updateNote(
    revision.noteId,
    {
      content: revision.previousContent,
      scope: revision.previousScope ?? note.scope,
      expiresAt: revision.previousExpiresAt ?? null,
    },
    actor,
  );
}

/** Rendered into skill results and the assistant prompt: enough to act on, no more. */
export function formatNoteLine(note: Note): string {
  const flags = [
    note.scope,
    note.expiresAt ? `expires ${note.expiresAt}` : null,
    note.deletedAt ? "deleted" : null,
    `by ${note.createdBy ?? "system"}${note.updatedBy ? `, edited by ${note.updatedBy}` : ""}`,
  ].filter(Boolean);
  return `${note.id} [${flags.join(" | ")}]\n${note.content}`;
}
