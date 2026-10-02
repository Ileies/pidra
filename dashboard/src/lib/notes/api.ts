/**
 * Client side of the notes API.
 *
 * The mutating calls (`createNote`, `updateNote`, `deleteNote`, `restoreNote`) go through the
 * offline outbox: they apply to the mirror immediately and queue the real
 * write, so they resolve the same way online or off and the caller never sees a network error for
 * a write that is simply going to retry. `noteHistory` and `revertRevision` stay direct calls to
 * the skills bridge proxy - reverting a revision is a correction-adjacent write kept online-only
 * (replayed later it would land on whatever the note has become), and history is read-only
 * trivia, not core to reading or writing a note.
 */

import * as outbox from "#lib/offline/outbox.js";
import { netJson } from "#lib/offline/net.js";

/** Snake_case shape the mirror and the (former) page load both use, as Postgres returns it. */
export interface NoteRow {
  id: string;
  content: string;
  scope: string;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  revision_count: number;
  /** Mirror-only, set by the outbox: an offline edit's `base_updated_at`
   *  did not match the row's actual `updated_at` when it flushed - "changed on the server while
   *  you were offline". Never present in a server response; only `NoteCard` reads it. */
  conflicted?: boolean;
}

export interface NoteApiRow {
  id: string;
  content: string;
  scope: string;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: string | null;
}

export interface NoteRevisionRow {
  id: string;
  noteId: string;
  operation: string;
  previousContent: string | null;
  previousScope: string | null;
  previousExpiresAt: string | null;
  changedBy: string;
  skillExecutionId: string | null;
  conversationId: string | null;
  createdAt: string | null;
}

export interface NotePatch {
  content?: string;
  scope?: string;
  expires_at?: string | null;
}

function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  return netJson<T>(`/api/notes${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const createNote = (input: { content: string; scope?: string; expires_at?: string | null }) =>
  outbox.createNote({ content: input.content, scope: input.scope, expiresAt: input.expires_at });

export const updateNote = (id: string, patch: NotePatch) =>
  outbox.updateNote(id, { content: patch.content, scope: patch.scope, ...("expires_at" in patch ? { expiresAt: patch.expires_at ?? null } : {}) });

export const deleteNote = (id: string) => outbox.deleteNote(id);

export const restoreNote = (id: string) => outbox.restoreNote(id);

export const noteHistory = (id: string) => call<NoteRevisionRow[]>(`/${id}/history`, "GET");

export const revertRevision = (revisionId: string) =>
  call<NoteApiRow>(`/revisions/${revisionId}/revert`, "POST");

export const NOTE_SCOPES = ["global", "intel", "personal", "contact", "search"] as const;

/**
 * Scope is the one place a note's colour carries meaning, and the word is always beside it.
 * `hint` says what the scope does to the briefing, as `phase3-context.ts` and `search/slots.ts` read it.
 */
export const SCOPE_INFO: Record<string, { classes: string; hint: string }> = {
  global: {
    classes: "text-primary-300 bg-primary-950 border-primary-800",
    hint: "Steers both Section 1 and Section 2 of every briefing.",
  },
  intel: {
    classes: "text-warning-400 bg-warning-950 border-warning-800",
    hint: "Steers Section 1, the intelligence briefing.",
  },
  personal: {
    classes: "text-success-400 bg-success-950 border-success-800",
    hint: "Steers Section 2, your personal briefing.",
  },
  contact: {
    classes: "text-surface-200 bg-surface-800 border-surface-600",
    hint: "Reference only: no briefing reads these yet.",
  },
  search: {
    classes: "text-surface-300 bg-surface-900 border-surface-700",
    hint: "Topics the daily monitoring web search looks up.",
  },
};

export const SCOPE_FALLBACK_CLASS = "text-surface-300 bg-surface-900 border-surface-700";

/** What an open editor holds: a new note (no row yet) or an edit of an existing one. */
export interface Draft {
  content: string;
  scope: string;
  /** `YYYY-MM-DD`, or "" for no expiry. */
  expires: string;
  saving: boolean;
  error: string | null;
}
