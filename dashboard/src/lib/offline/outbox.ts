/**
 * The write path (OFFLINE_PLAN.md §6). A page never writes the mirror directly (§3, decision 3):
 * it calls one of the functions below, which appends an intent, applies its effect to the mirror
 * optimistically, and tries to flush. `sync.ts` is the only other writer of the mirror, and it
 * calls `flush()` before every pull and `reapplyPending()` after, so a write still queued when a
 * pull lands is not clobbered by what the pull brings back - see the comment on `reapplyPending`.
 *
 * One writer, `applyOptimistic`, used both when an intent is first queued and whenever it needs
 * to be re-asserted on top of fresh server data. It has to be idempotent for that reason: running
 * it twice for the same intent must produce the same mirror state as running it once.
 */

import * as db from "./db.js";
import type { NoteRow } from "#lib/notes/api.js";
import type { MirroredReport, MirroredExtraction, MirroredRule } from "./repo.js";

export type IntentKind =
  | "note.create" | "note.update" | "note.delete" | "note.restore"
  | "rate"
  | "rule.create" | "rule.update" | "rule.delete";

export interface Intent {
  id: string;
  seq: number;
  kind: IntentKind;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

/** Monotonic within one tab session, which is all ordering needs to guarantee here: intents from
 *  the same tab flush in the order they were queued. Seeded from whatever is already queued so a
 *  reload does not restart the counter at 0 and reorder anything still pending. */
let seqCounter: number | null = null;

async function nextSeq(): Promise<number> {
  if (seqCounter === null) {
    const existing = await db.getAll<Intent>("outbox");
    seqCounter = existing.reduce((max, i) => Math.max(max, i.seq), 0);
  }
  seqCounter += 1;
  return seqCounter;
}

async function sortedOutbox(): Promise<Intent[]> {
  const all = await db.getAll<Intent>("outbox");
  return all.sort((a, b) => a.seq - b.seq);
}

// --- optimistic mirror application ---

async function patchReportsRating(extractionId: string, eventType: string): Promise<void> {
  const reports = await db.getAll<MirroredReport>("reports");
  for (const report of reports) {
    if (report.ratings[extractionId] === eventType) continue;
    await db.put("reports", { ...report, ratings: { ...report.ratings, [extractionId]: eventType } });
  }

  const extraction = await db.get<MirroredExtraction>("extractions", extractionId);
  if (extraction && extraction.rating !== eventType) {
    await db.put("extractions", { ...extraction, rating: eventType });
  }
}

/** `null` payloads for fields the caller left untouched: `content`/`scope` omitted means "leave
 *  it", `expiresAt` present-but-null means "clear it" - the same convention `NoteWrite` uses. */
interface NotePatchPayload {
  content?: string;
  scope?: string;
  expiresAt?: string | null;
}

async function applyOptimistic(intent: Intent): Promise<void> {
  switch (intent.kind) {
    case "note.create": {
      const p = intent.payload as { id: string; content: string; scope: string; expiresAt: string | null };
      // A create is only ever re-applied (via reapplyPending) while still unflushed, so there is
      // nothing server-side yet to merge with - the same object every time is correct.
      const note: NoteRow = {
        id: p.id, content: p.content, scope: p.scope,
        created_at: intent.createdAt, updated_at: null, expires_at: p.expiresAt,
        created_by: "user", updated_by: null, deleted_at: null, revision_count: 0,
      };
      await db.put("notes", note);
      return;
    }
    case "note.update": {
      const p = intent.payload as { id: string; patch: NotePatchPayload };
      const current = await db.get<NoteRow>("notes", p.id);
      if (!current) return; // created-then-deleted-then-reapplied races; nothing to patch onto.
      await db.put("notes", {
        ...current,
        ...(p.patch.content === undefined ? {} : { content: p.patch.content }),
        ...(p.patch.scope === undefined ? {} : { scope: p.patch.scope }),
        ...("expiresAt" in p.patch ? { expires_at: p.patch.expiresAt ?? null } : {}),
        updated_at: intent.createdAt,
        updated_by: "user",
      });
      return;
    }
    case "note.delete": {
      const p = intent.payload as { id: string };
      const current = await db.get<NoteRow>("notes", p.id);
      if (current) await db.put("notes", { ...current, deleted_at: intent.createdAt, updated_at: intent.createdAt, updated_by: "user" });
      return;
    }
    case "note.restore": {
      const p = intent.payload as { id: string };
      const current = await db.get<NoteRow>("notes", p.id);
      if (current) await db.put("notes", { ...current, deleted_at: null, updated_at: intent.createdAt, updated_by: "user" });
      return;
    }
    case "rate": {
      const p = intent.payload as { extractionId: string; signal: "1" | "-1" };
      await patchReportsRating(p.extractionId, p.signal === "1" ? "explicit_plus" : "explicit_minus");
      return;
    }
    case "rule.create": {
      const p = intent.payload as { localId: string; key: string; value: string };
      // Only ever holds until the real row arrives on the next successful pull, keyed by the
      // server's own id (OFFLINE_PLAN.md O3) - pruneToIds then drops this temporary row for us.
      const rule: MirroredRule = { id: p.localId, key: p.key, value: p.value, source: "user", updatedAt: intent.createdAt };
      await db.put("rules", rule);
      return;
    }
    case "rule.update": {
      const p = intent.payload as { id: string; value: string };
      const current = await db.get<MirroredRule>("rules", p.id);
      if (current) await db.put("rules", { ...current, value: p.value, source: "user", updatedAt: intent.createdAt });
      return;
    }
    case "rule.delete": {
      const p = intent.payload as { id: string };
      await db.del("rules", p.id);
      return;
    }
  }
}

/**
 * Re-runs every still-pending intent's optimistic effect on top of whatever `sync.ts` just pulled.
 * A pull replaces mirror rows wholesale from the server's own state, which by definition does not
 * yet reflect an intent that has not flushed - without this, a queued note edit or an unflushed
 * rating would appear to be discarded the moment the app comes back online and syncs, even though
 * the outbox still holds it and will deliver it. Order matters here too, so this reads the outbox
 * the same way `flush()` does.
 */
export async function reapplyPending(): Promise<void> {
  for (const intent of await sortedOutbox()) await applyOptimistic(intent);
}

// --- status change notifications ---

/** The header dot and the sync sheet (OFFLINE_PLAN.md O4) read `pending()`/`failed()` on demand
 *  rather than owning outbox state themselves; this is how they know when to ask again. Plain
 *  callbacks, not a store of their own - `state.svelte.ts` is the one place that turns "something
 *  changed" into a re-render. */
const listeners = new Set<() => void>();

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

// --- enqueue ---

async function enqueue(kind: IntentKind, payload: Record<string, unknown>): Promise<void> {
  const intent: Intent = {
    id: crypto.randomUUID(),
    seq: await nextSeq(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  await applyOptimistic(intent);
  await db.put("outbox", intent);
  notify();
  flush().catch(() => {}); // best effort; failures stay queued and the caller never waits on them
}

export async function createNote(input: { content: string; scope?: string; expiresAt?: string | null }): Promise<void> {
  await enqueue("note.create", {
    id: crypto.randomUUID(),
    content: input.content,
    scope: input.scope ?? "global",
    expiresAt: input.expiresAt ?? null,
  });
}

export async function updateNote(id: string, patch: NotePatchPayload): Promise<void> {
  const current = await db.get<NoteRow>("notes", id);
  await enqueue("note.update", { id, patch, baseUpdatedAt: current?.updated_at ?? null });
}

export async function deleteNote(id: string): Promise<void> {
  await enqueue("note.delete", { id });
}

export async function restoreNote(id: string): Promise<void> {
  await enqueue("note.restore", { id });
}

/** Collapses a queued rating for the same extraction (§6: "collapse queued duplicates per
 *  extraction id") - a re-tap before the first tap has flushed replaces the queued intent rather
 *  than piling up a second one behind it. */
export async function rate(extractionId: string, signal: "1" | "-1"): Promise<void> {
  for (const intent of await db.getAll<Intent>("outbox")) {
    if (intent.kind === "rate" && (intent.payload as { extractionId: string }).extractionId === extractionId) {
      await db.del("outbox", intent.id);
    }
  }
  await enqueue("rate", { extractionId, signal });
}

export async function createRule(key: string, value: string): Promise<void> {
  await enqueue("rule.create", { localId: crypto.randomUUID(), key, value });
}

export async function updateRule(id: string, value: string): Promise<void> {
  await enqueue("rule.update", { id, value });
}

export async function deleteRule(id: string): Promise<void> {
  await enqueue("rule.delete", { id });
}

// --- flush ---

const REQUEST_TIMEOUT_MS = 8000;

/** Thrown for anything that will never succeed by retrying - a validation error, a 404 on a
 *  target that no longer exists. Distinct from a thrown `TypeError`/`AbortError`, which is always
 *  transport (offline, or the origin unreachable) and always retried. */
class TerminalError extends Error {}

async function send(intent: Intent): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await request(intent, controller.signal);
    if (res.ok) return res;
    if (res.status >= 400 && res.status < 500) {
      const body = await res.text().catch(() => "");
      throw new TerminalError(`${res.status}: ${body.slice(0, 200)}`);
    }
    throw new Error(`server error ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

/** `PATCH /api/notes/:id` reports whether the row moved since the edit's `base_updated_at`
 *  (OFFLINE_PLAN.md §6) - the mechanic behind O4's "changed on the server" flag. Nothing else the
 *  outbox sends carries a response worth reading past its status. */
async function markConflictIfFlagged(intent: Intent, res: Response): Promise<void> {
  if (intent.kind !== "note.update") return;
  const body = (await res.json().catch(() => null)) as { _conflict?: boolean } | null;
  const p = intent.payload as { id: string };
  const current = await db.get<NoteRow>("notes", p.id);
  // Set unconditionally, not just on a conflict: a later edit that lands cleanly clears a flag an
  // earlier one left, rather than the note staying marked forever.
  if (current) await db.put("notes", { ...current, conflicted: !!body?._conflict });
}

function request(intent: Intent, signal: AbortSignal): Promise<Response> {
  const json = (body: unknown) => JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };

  switch (intent.kind) {
    case "note.create": {
      const p = intent.payload as { id: string; content: string; scope: string; expiresAt: string | null };
      return fetch("/api/notes", { method: "POST", headers, signal, body: json({ id: p.id, content: p.content, scope: p.scope, expires_at: p.expiresAt }) });
    }
    case "note.update": {
      const p = intent.payload as { id: string; patch: NotePatchPayload; baseUpdatedAt: string | null };
      return fetch(`/api/notes/${p.id}`, { method: "PATCH", headers, signal, body: json({ ...p.patch, base_updated_at: p.baseUpdatedAt }) });
    }
    case "note.delete": {
      const p = intent.payload as { id: string };
      return fetch(`/api/notes/${p.id}`, { method: "DELETE", signal });
    }
    case "note.restore": {
      const p = intent.payload as { id: string };
      return fetch(`/api/notes/${p.id}/restore`, { method: "POST", signal });
    }
    case "rate": {
      const p = intent.payload as { extractionId: string; signal: "1" | "-1" };
      return fetch("/api/feedback", { method: "POST", headers, signal, body: json({ extraction_id: p.extractionId, signal: p.signal }) });
    }
    case "rule.create": {
      const p = intent.payload as { key: string; value: string };
      return fetch("/api/rules", { method: "POST", headers, signal, body: json({ key: p.key, value: p.value }) });
    }
    case "rule.update": {
      const p = intent.payload as { id: string; value: string };
      return fetch(`/api/rules/${p.id}`, { method: "PATCH", headers, signal, body: json({ value: p.value }) });
    }
    case "rule.delete": {
      const p = intent.payload as { id: string };
      return fetch(`/api/rules/${p.id}`, { method: "DELETE", signal });
    }
  }
}

let flushing: Promise<void> | null = null;

/**
 * Drains the outbox in order, stopping at the first intent a transport failure could not
 * deliver - a later intent might depend on an earlier one (an edit on a note the same queue is
 * still trying to create), so skipping ahead would invert that. A terminal failure is different:
 * it will never succeed no matter how long it waits, so it is moved to `failed` (payload intact,
 * OFFLINE_PLAN.md §6) and the loop moves on rather than jamming everything behind it forever.
 *
 * Safe to call whenever: on its own it is a no-op with an empty queue, and concurrent calls
 * (an enqueue, a `visibilitychange`, a `pull()`) share one in-flight run rather than racing.
 */
export function flush(): Promise<void> {
  flushing ??= run().finally(() => { flushing = null; });
  return flushing;
}

async function run(): Promise<void> {
  for (const intent of await sortedOutbox()) {
    try {
      const res = await send(intent);
      await markConflictIfFlagged(intent, res);
      await db.del("outbox", intent.id);
      notify();
    } catch (err) {
      if (err instanceof TerminalError) {
        await db.put("failed", { ...intent, lastError: err.message });
        await db.del("outbox", intent.id);
        notify();
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      await db.put("outbox", { ...intent, attempts: intent.attempts + 1, lastError: message });
      notify();
      return; // transport failure: stop here, ordering is preserved for the next attempt
    }
  }
}

export async function pending(): Promise<Intent[]> {
  return sortedOutbox();
}

export async function failed(): Promise<Intent[]> {
  const all = await db.getAll<Intent>("failed");
  return all.sort((a, b) => a.seq - b.seq);
}

/** Re-queues a failed intent at the tail - not back in its original position, because whatever
 *  was behind it has long since flushed - and tries again immediately. */
export async function retryFailed(id: string): Promise<void> {
  const intent = await db.get<Intent>("failed", id);
  if (!intent) return;
  await db.del("failed", id);
  await db.put("outbox", { ...intent, seq: await nextSeq(), attempts: 0, lastError: null });
  notify();
  flush().catch(() => {});
}

export async function discardFailed(id: string): Promise<void> {
  await db.del("failed", id);
  notify();
}
