/**
 * Client side of the notes API. Everything here proxies to the skills bridge, which owns
 * `src/notes/store.ts` - the single writer of `notes` and `note_revisions`.
 *
 * The bridge answers with Drizzle rows, so these are camelCase. The page's own `load` reads
 * Postgres directly and yields snake_case (`NoteRow`); the UI refreshes from that after a write
 * rather than patching bridge responses into the list.
 */

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

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/notes${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }

  if (!res.ok) {
    const message = (parsed as { error?: string } | null)?.error;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return parsed as T;
}

export const createNote = (input: { content: string; scope?: string; expires_at?: string | null }) =>
  call<NoteApiRow>("", "POST", input);

export const updateNote = (id: string, patch: NotePatch) => call<NoteApiRow>(`/${id}`, "PATCH", patch);

export const deleteNote = (id: string) => call<NoteApiRow>(`/${id}`, "DELETE");

export const restoreNote = (id: string) => call<NoteApiRow>(`/${id}/restore`, "POST");

export const noteHistory = (id: string) => call<NoteRevisionRow[]>(`/${id}/history`, "GET");

export const revertRevision = (revisionId: string) =>
  call<NoteApiRow>(`/revisions/${revisionId}/revert`, "POST");

export const NOTE_SCOPES = ["global", "intel", "personal", "contact", "search"] as const;

/** Scope is the one place a note's colour carries meaning, and the word is always beside it. */
export const SCOPE_CLASS: Record<string, string> = {
  global: "text-primary-300 bg-primary-950 border-primary-800",
  intel: "text-warning-400 bg-warning-950 border-warning-800",
  personal: "text-success-400 bg-success-950 border-success-800",
  contact: "text-surface-200 bg-surface-800 border-surface-600",
  search: "text-surface-300 bg-surface-900 border-surface-700",
};
