import { isUuid, isDateKey } from "../util/ids";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db, notes, noteRevisions } from "../db";
import { addDays, utcDay } from "../util/time";
import { NoteError } from "./errors";
import type { NoteTargets } from "./select";
import { targetingConditions, type TargetingFilters } from "./filters";
import { describeTargets, normaliseSteps, normaliseTargets, sameJson } from "./targeting";

export { NoteError };

/**
 * The only writer of `notes` and `note_revisions` (the mutable layer, see docs/architecture-rules.md).
 * Callers: dashboard note routes (src/server/routes/notes.ts), note skills in skills/, the pipeline
 * (Phase 6 `<!--SYSTEM-->` notes), the Context Builder (`seedHarvestedNotes`).
 * Invariant: every mutation appends the pre-change state to `note_revisions` and a delete only sets
 * `deleted_at`, so UI and chat edits cannot skip the history. Corrections to the harvested context
 * live in src/context/corrections.ts instead.
 * Errors are `NoteError` (HttpError: 404 for "not found", else 400).
 */

export const NOTE_SCOPES = ["global", "intel", "personal", "contact", "search"] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

export type Note = typeof notes.$inferSelect;
export type NoteRevision = typeof noteRevisions.$inferSelect;

/** Who is making the change, and what to point the revision back at. */
export interface Actor {
  by: "user" | "chat" | "system" | "harvest";
  skillExecutionId?: string | null;
  conversationId?: string | null;
}

export interface NoteWrite {
  content?: string;
  scope?: string;
  /** `null` clears the expiry; omitted leaves it untouched. */
  expiresAt?: string | null;
  /** Steps that load the note (`NOTE_STEPS`); `[]` means every step its scope reaches. Omitted leaves it untouched. */
  steps?: string[];
  /** `null` or all-empty lists make the note untargeted; omitted leaves it untouched. */
  appliesTo?: NoteTargets | null;
  /** First live day; `null` means live at once, omitted leaves it untouched. */
  activeFrom?: string | null;
  /** The review question(s) this note was drawn from (`absorbReviewAnswers`). Create-only. */
  sourceQuestionIds?: string[];
}

export interface ListOptions extends TargetingFilters {
  scope?: string;
  /** Substring match on content. */
  query?: string;
  /** `active` (default) hides soft-deleted notes, `deleted` shows only those, `all` shows both. */
  include?: "active" | "deleted" | "all";
  sort?: "newest" | "oldest" | "edited";
  limit?: number;
  /** Who created the note: user | chat | system | harvest. */
  createdBy?: string;
  /** Created on or after this day (`YYYY-MM-DD`, UTC). */
  createdSince?: string;
  /** Has an expiry on or before this day (`YYYY-MM-DD`). Notes without an expiry never match. */
  expiresBefore?: string;
}

export const NOTE_SORTS = ["newest", "oldest", "edited"] as const;
export const NOTE_AUTHORS = ["user", "chat", "system", "harvest"] as const;

function assertUuid(id: string, label = "note_id"): string {
  const value = (id ?? "").trim();
  if (!isUuid(value)) throw new NoteError(`${label} must be a UUID`);
  return value;
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new NoteError(`${label} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function assertDate(value: string, label: string): string {
  if (!isDateKey(value)) throw new NoteError(`${label} must be a date as YYYY-MM-DD`);
  return value;
}

function normaliseScope(scope: string): NoteScope {
  return assertOneOf((scope ?? "").trim().toLowerCase(), NOTE_SCOPES, "scope");
}

function normaliseExpiry(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? assertDate(trimmed, "expires_at") : null;
}

/** The pre-change targeting for a `note_revisions` row. */
const previousTargeting = (note: Note) => ({
  previousSteps: note.steps,
  previousAppliesTo: note.appliesTo,
  previousActiveFrom: note.activeFrom,
});

/** `days` from today (UTC) as `YYYY-MM-DD`, for a caller that thinks in "a week" rather than dates. */
export function expiryInDays(days: unknown): string {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new NoteError("expires_in_days must be a whole number from 1 to 3650");
  return addDays(utcDay(), n);
}

export async function listNotes(opts: ListOptions = {}): Promise<Note[]> {
  const filters = [];

  if (opts.include === "deleted") filters.push(isNotNull(notes.deletedAt));
  else if (opts.include !== "all") filters.push(isNull(notes.deletedAt));

  if (opts.scope) filters.push(eq(notes.scope, normaliseScope(opts.scope)));

  const query = opts.query?.trim();
  if (query) filters.push(ilike(notes.content, `%${query}%`));

  if (opts.createdBy) filters.push(eq(notes.createdBy, assertOneOf(opts.createdBy, NOTE_AUTHORS, "created_by")));
  if (opts.createdSince) {
    filters.push(sql`(${notes.createdAt} AT TIME ZONE 'UTC')::date >= ${assertDate(opts.createdSince, "created_since")}::date`);
  }
  if (opts.expiresBefore) filters.push(lte(notes.expiresAt, assertDate(opts.expiresBefore, "expires_before")));
  filters.push(...targetingConditions(opts));

  const order = opts.sort === "oldest"
    ? asc(notes.createdAt)
    : opts.sort === "edited"
      ? desc(sql`coalesce(${notes.updatedAt}, ${notes.createdAt})`)
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

/**
 * `id` is only ever client-supplied by the offline outbox (docs/offline-mode.md), so the mirror and
 * the server row share an identity. `onConflictDoNothing` makes replaying a create idempotent: the
 * first attempt's row is returned either way.
 */
export async function createNote(input: NoteWrite & { content: string; id?: string }, actor: Actor): Promise<Note> {
  const content = (input.content ?? "").trim();
  if (!content) throw new NoteError("content is required");
  const id = input.id === undefined ? undefined : assertUuid(input.id, "id");

  const [row] = await db
    .insert(notes)
    .values({
      ...(id === undefined ? {} : { id }),
      content,
      scope: normaliseScope(input.scope ?? "global"),
      expiresAt: input.expiresAt === undefined ? null : normaliseExpiry(input.expiresAt),
      steps: normaliseSteps(input.steps ?? []),
      appliesTo: normaliseTargets(input.appliesTo ?? null),
      activeFrom: input.activeFrom ? assertDate(input.activeFrom.trim(), "active_from") : null,
      ...(input.sourceQuestionIds?.length ? { sourceQuestionIds: input.sourceQuestionIds } : {}),
      // Provenance of the *creation*, and never rewritten afterwards. A later edit only sets
      // `updated_by`, so a Phase 6 note the user fixed still reads as pipeline-written.
      createdBy: actor.by,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;
  const existing = id === undefined ? null : await getNote(id);
  if (existing) return existing;
  throw new NoteError("failed to create note");
}

/**
 * Seeds the standing rules the Context Builder found in Keep, each under its stable `sourceKey`.
 *
 * A key with no row is inserted as a `personal` note. A key whose row exists is left as it is,
 * trashed or edited included: that is what stops a re-run from resurrecting a rule you deleted or
 * overwriting one you rewrote. The one exception is a live row nobody has touched, which follows
 * the Keep note's new text (and records the old text as a revision).
 */
export async function seedHarvestedNotes(items: { key: string; content: string }[]): Promise<{ added: number; refreshed: number }> {
  const wanted = new Map(items.filter((i) => i.key && i.content.trim()).map((i) => [i.key, i.content.trim()]));
  if (wanted.size === 0) return { added: 0, refreshed: 0 };

  const existing = await db.select().from(notes).where(inArray(notes.sourceKey, [...wanted.keys()]));
  const byKey = new Map(existing.map((row) => [row.sourceKey as string, row]));

  const fresh = [...wanted].filter(([key]) => !byKey.has(key));
  if (fresh.length > 0) {
    await db
      .insert(notes)
      .values(fresh.map(([key, content]) => ({ content, scope: "personal", createdBy: "harvest", sourceKey: key })))
      .onConflictDoNothing();
  }

  let refreshed = 0;
  for (const [key, content] of wanted) {
    const row = byKey.get(key);
    if (!row || row.deletedAt || (row.updatedBy !== null && row.updatedBy !== "harvest") || row.content.trim() === content) continue;
    await db.transaction(async (tx) => {
      await tx.insert(noteRevisions).values({
        noteId: row.id,
        operation: "update",
        previousContent: row.content,
        previousScope: row.scope,
        previousExpiresAt: row.expiresAt,
        ...previousTargeting(row),
        changedBy: "harvest",
      });
      await tx.update(notes).set({ content, updatedAt: sql`now()`, updatedBy: "harvest" }).where(eq(notes.id, row.id));
    });
    refreshed++;
  }
  return { added: fresh.length, refreshed };
}

/** Whether the row moved since `baseUpdatedAt` (what an offline edit was based on); false if the row is gone. Not atomic with the later write, fine for a single user. */
export async function wasUpdatedSince(id: string, baseUpdatedAt: string | null): Promise<boolean> {
  const note = await getNote(assertUuid(id));
  if (!note) return false;
  return (note.updatedAt ?? null) !== (baseUpdatedAt ?? null);
}

/**
 * One mutation: load the note, let `decide` pick the change (or null for "nothing to do", which
 * returns the note as it is), append the pre-change state to the history and apply it, all in one
 * transaction. `decide` throws for a note that is in the wrong state for the operation.
 */
async function mutateNote(
  id: string,
  operation: "update" | "delete" | "restore",
  actor: Actor,
  decide: (current: Note) => { [K in keyof Note]?: Note[K] | SQL } | null,
): Promise<Note> {
  const noteId = assertUuid(id);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(notes).where(eq(notes.id, noteId)).limit(1);
    if (!current) throw new NoteError(`note ${noteId} not found`);
    const change = decide(current);
    if (!change) return current;

    await tx.insert(noteRevisions).values({
      noteId,
      operation,
      previousContent: current.content,
      previousScope: current.scope,
      previousExpiresAt: current.expiresAt,
      ...previousTargeting(current),
      changedBy: actor.by,
      skillExecutionId: actor.skillExecutionId ?? null,
      conversationId: actor.conversationId ?? null,
    });

    const [row] = await tx
      .update(notes)
      .set({ ...change, updatedAt: sql`now()`, updatedBy: actor.by })
      .where(eq(notes.id, noteId))
      .returning();
    return row;
  });
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

  const nextSteps = patch.steps === undefined ? undefined : normaliseSteps(patch.steps);
  const touchesTargets = "appliesTo" in patch;
  const nextTargets = touchesTargets ? normaliseTargets(patch.appliesTo ?? null) : undefined;
  const touchesActiveFrom = "activeFrom" in patch;
  const nextActiveFrom = touchesActiveFrom && patch.activeFrom?.trim() ? assertDate(patch.activeFrom.trim(), "active_from") : null;

  if (nextContent === undefined && nextScope === undefined && !touchesExpiry && nextSteps === undefined && !touchesTargets && !touchesActiveFrom) {
    throw new NoteError("nothing to update: pass content, scope, expires_at, steps, applies_to or active_from");
  }

  return mutateNote(noteId, "update", actor, (current) => {
    if (current.deletedAt) throw new NoteError(`note ${noteId} is deleted - restore it first`);

    const unchanged =
      (nextContent === undefined || nextContent === current.content) &&
      (nextScope === undefined || nextScope === current.scope) &&
      (!touchesExpiry || (nextExpiry ?? null) === (current.expiresAt ?? null)) &&
      (nextSteps === undefined || sameJson(nextSteps, current.steps)) &&
      (!touchesTargets || sameJson(nextTargets, current.appliesTo)) &&
      (!touchesActiveFrom || nextActiveFrom === (current.activeFrom ?? null));
    if (unchanged) return null;

    return {
      ...(nextContent === undefined ? {} : { content: nextContent }),
      ...(nextScope === undefined ? {} : { scope: nextScope }),
      ...(touchesExpiry ? { expiresAt: nextExpiry ?? null } : {}),
      ...(nextSteps === undefined ? {} : { steps: nextSteps }),
      ...(touchesTargets ? { appliesTo: nextTargets ?? null } : {}),
      ...(touchesActiveFrom ? { activeFrom: nextActiveFrom } : {}),
    };
  });
}

/**
 * Soft delete. This is why `delete_note` can stay a low-risk skill: nothing is lost, the note
 * leaves the briefing payload immediately, and the UI offers an undo.
 */
export function softDeleteNote(id: string, actor: Actor): Promise<Note> {
  return mutateNote(id, "delete", actor, (current) => (current.deletedAt ? null : { deletedAt: sql`now()` }));
}

/**
 * Purge each note once it has spent 30 days in trash. Revisions cascade with the note. A note the
 * Context Builder seeded stays in the trash for good: its row is what tells the next seed that
 * the rule was deleted on purpose.
 */
export async function pruneDeletedNotes(): Promise<void> {
  const purged = await db
    .delete(notes)
    .where(sql`${notes.deletedAt} <= now() - interval '30 days' AND ${notes.sourceKey} IS NULL`)
    .returning({ id: notes.id });

  console.log(`[notes] Purged ${purged.length} notes from trash`);
}

export function restoreNote(id: string, actor: Actor): Promise<Note> {
  return mutateNote(id, "restore", actor, (current) => (current.deletedAt ? { deletedAt: null } : null));
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
      // A revision from before targeting existed records none of it, so the current targeting stays.
      ...(revision.previousSteps === null
        ? {}
        : { steps: revision.previousSteps, appliesTo: revision.previousAppliesTo, activeFrom: revision.previousActiveFrom }),
    },
    actor,
  );
}

/** Rendered into skill results and the assistant prompt: enough to act on, no more. */
export function formatNoteLine(note: Note): string {
  const flags = [
    note.scope,
    note.activeFrom ? `from ${note.activeFrom}` : null,
    note.expiresAt ? `expires ${note.expiresAt}` : null,
    note.steps.length > 0 ? `steps: ${note.steps.join(", ")}` : null,
    describeTargets(note.appliesTo),
    note.deletedAt ? "deleted" : null,
    `by ${note.createdBy ?? "system"}${note.updatedBy ? `, edited by ${note.updatedBy}` : ""}`,
  ].filter(Boolean);
  return `${note.id} [${flags.join(" | ")}]\n${note.content}`;
}
