/**
 * The outbox's core, in the one form both the pages and the service worker
 * can run: what an intent is, what it does to the mirror, and how the queue is drained. It imports
 * nothing but `db.ts` and types, because the worker has no `window` and no SvelteKit router; the
 * transport is handed in. `outbox.ts` is the page's API on top of this, and the worker drains the
 * same queue on a push, a Background Sync or a periodic sync, so a write queued offline can
 * land with the app closed.
 *
 * One writer, `applyOptimistic`, used both when an intent is first queued and whenever it needs
 * to be re-asserted on top of fresh server data. It has to be idempotent for that reason: running
 * it twice for the same intent must produce the same mirror state as running it once.
 */

import * as db from "./db.js";
import type { MirrorStore } from "./db.js";
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

export const INTENT_LABEL: Record<IntentKind, string> = {
  "note.create": "New note",
  "note.update": "Note edit",
  "note.delete": "Note deleted",
  "note.restore": "Note restored",
  rate: "Rating",
  "rule.create": "New rule",
  "rule.update": "Rule edit",
  "rule.delete": "Rule deleted",
};

/** The row an intent is about: a note, a rule (a queued create's temporary id), or an extraction. */
export function intentTarget(intent: Intent): string {
  const p = intent.payload as { id?: string; localId?: string; extractionId?: string };
  return p.localId ?? p.id ?? p.extractionId ?? "";
}

/** Whether an intent writes a row of this kind with this id, which is where its state is shown. */
export function intentIsFor(intent: Intent, row: "note" | "rule" | "rate", id: string): boolean {
  const family = intent.kind === "rate" ? "rate" : intent.kind.split(".")[0];
  return family === row && intentTarget(intent) === id;
}

/** Enough of the payload to say what changed, for a write whose row is not on screen. */
export function intentSummary(intent: Intent): string {
  const p = intent.payload as Record<string, unknown>;
  if (intent.kind === "note.create") return String(p.content ?? "").slice(0, 60);
  if (intent.kind === "rule.create") return String(p.key ?? "");
  const target = intentTarget(intent);
  return intent.kind === "rate" ? `extraction ${target.slice(0, 8)}…` : `${target.slice(0, 8)}…`;
}

/** How a request goes out: `net()` in a page, a bounded `fetch` in the worker. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function sortedOutbox(): Promise<Intent[]> {
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
export interface NotePatchPayload {
  content?: string;
  scope?: string;
  expiresAt?: string | null;
}

export async function applyOptimistic(intent: Intent): Promise<void> {
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
      // server's own id - that pull's id list does not name this temporary
      // row, so `db.reconcile` drops it for us.
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
 * Re-runs every still-pending intent's optimistic effect on top of whatever a snapshot just
 * brought. A pull replaces mirror rows wholesale from the server's own state, which by definition
 * does not yet reflect an intent that has not flushed - without this, a queued note edit or an
 * unflushed rating would appear to be discarded the moment the app comes back online and syncs,
 * even though the outbox still holds it and will deliver it. Order matters here too, so this reads
 * the outbox the same way `drain()` does.
 */
export async function reapplyPending(): Promise<void> {
  for (const intent of await sortedOutbox()) await applyOptimistic(intent);
}

/** The mirror stores an intent's optimistic effect writes, so exactly their loads re-run. */
export function storesOf(kind: IntentKind): MirrorStore[] {
  if (kind === "rate") return ["reports", "extractions"];
  return kind.startsWith("note.") ? ["notes"] : ["rules"];
}

// --- drain ---

/** Thrown for anything that will never succeed by retrying - a validation error, a 404 on a
 *  target that no longer exists. Distinct from a transport failure (offline, or the origin slow
 *  or unreachable), which is always retried. */
class TerminalError extends Error {}

function request(intent: Intent, send: Fetcher): Promise<Response> {
  const json = (body: unknown) => JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };

  switch (intent.kind) {
    case "note.create": {
      const p = intent.payload as { id: string; content: string; scope: string; expiresAt: string | null };
      return send("/api/notes", { method: "POST", headers, body: json({ id: p.id, content: p.content, scope: p.scope, expires_at: p.expiresAt }) });
    }
    case "note.update": {
      const p = intent.payload as { id: string; patch: NotePatchPayload; baseUpdatedAt: string | null };
      return send(`/api/notes/${p.id}`, { method: "PATCH", headers, body: json({ ...p.patch, base_updated_at: p.baseUpdatedAt }) });
    }
    case "note.delete": {
      const p = intent.payload as { id: string };
      return send(`/api/notes/${p.id}`, { method: "DELETE" });
    }
    case "note.restore": {
      const p = intent.payload as { id: string };
      return send(`/api/notes/${p.id}/restore`, { method: "POST" });
    }
    case "rate": {
      const p = intent.payload as { extractionId: string; signal: "1" | "-1" };
      return send("/api/feedback", { method: "POST", headers, body: json({ extraction_id: p.extractionId, signal: p.signal }) });
    }
    case "rule.create": {
      const p = intent.payload as { key: string; value: string };
      return send("/api/rules", { method: "POST", headers, body: json({ key: p.key, value: p.value }) });
    }
    case "rule.update": {
      const p = intent.payload as { id: string; value: string };
      return send(`/api/rules/${p.id}`, { method: "PATCH", headers, body: json({ value: p.value }) });
    }
    case "rule.delete": {
      const p = intent.payload as { id: string };
      return send(`/api/rules/${p.id}`, { method: "DELETE" });
    }
  }
}

async function deliver(intent: Intent, send: Fetcher): Promise<Response> {
  const res = await request(intent, send);
  if (res.ok) return res;
  if (res.status >= 400 && res.status < 500) {
    const body = await res.text().catch(() => "");
    throw new TerminalError(`${res.status}: ${body.slice(0, 200)}`);
  }
  throw new Error(`server error ${res.status}`);
}

/** `PATCH /api/notes/:id` reports whether the row moved since the edit's `base_updated_at`
 *  - the mechanic behind the "changed on the server" flag on a note. Nothing else the
 *  outbox sends carries a response worth reading past its status. True when the mirror changed. */
async function markConflictIfFlagged(intent: Intent, res: Response): Promise<boolean> {
  if (intent.kind !== "note.update") return false;
  const body = (await res.json().catch(() => null)) as { _conflict?: boolean } | null;
  const p = intent.payload as { id: string };
  const current = await db.get<NoteRow>("notes", p.id);
  // Written whenever it differs, not just on a conflict: a later edit that lands cleanly clears a
  // flag an earlier one left, rather than the note staying marked forever.
  if (current && !!current.conflicted !== !!body?._conflict) {
    await db.put("notes", { ...current, conflicted: !!body?._conflict });
    return true;
  }
  return false;
}

export interface DrainOptions {
  /** True for an error that means the request never left the device, so it was not an attempt. */
  notSent?: (err: unknown) => boolean;
  /** After every change to the outbox or the failed list. */
  onChange?: () => void;
}

export interface DrainResult {
  /** False when a transport failure stopped the queue with intents still in it. */
  complete: boolean;
  /** How many intents reached the server. */
  delivered: number;
  /** Mirror stores the drain itself changed (a conflict flag), for the caller to invalidate. */
  changed: MirrorStore[];
}

/**
 * Drains the outbox in order, stopping at the first intent a transport failure could not
 * deliver - a later intent might depend on an earlier one (an edit on a note the same queue is
 * still trying to create), so skipping ahead would invert that. A terminal failure is different:
 * it will never succeed no matter how long it waits, so it is moved to `failed` (payload intact, so
 * the text can be recovered or re-filed) and the loop moves on rather than jamming everything
 * behind it forever.
 *
 * Under the `pidra-outbox` lock, so a page and the worker never send the same intent twice.
 */
export function drain(send: Fetcher, options: DrainOptions = {}): Promise<DrainResult> {
  return db.withLock("pidra-outbox", async () => {
    const changed = new Set<MirrorStore>();
    let delivered = 0;
    for (const intent of await sortedOutbox()) {
      try {
        const res = await deliver(intent, send);
        if (await markConflictIfFlagged(intent, res)) changed.add("notes");
        await db.del("outbox", intent.id);
        delivered++;
        options.onChange?.();
      } catch (err) {
        // Replaced while its request was out: `outbox.rate` drops the queued rating a new tap
        // supersedes, without waiting for this lock, and the request can take seconds to fail in a
        // blackhole. Writing the intent back would resurrect it and send both (found by
        // scripts/blackhole).
        if (!(await db.get<Intent>("outbox", intent.id))) {
          if (err instanceof TerminalError) continue;
          return { complete: false, delivered, changed: [...changed] };
        }
        if (err instanceof TerminalError) {
          await db.put("failed", { ...intent, lastError: err.message });
          await db.del("outbox", intent.id);
          // Its optimistic effect is still in the mirror and the server will never match it, so a
          // delta would never correct it either: without an ETag, the next sync is a full one.
          await db.del("meta", "etag");
          options.onChange?.();
          continue;
        }
        // Nothing left the device, so it was not an attempt and says nothing new.
        if (!options.notSent?.(err)) {
          const message = err instanceof Error ? err.message : String(err);
          await db.put("outbox", { ...intent, attempts: intent.attempts + 1, lastError: message });
          options.onChange?.();
        }
        return { complete: false, delivered, changed: [...changed] };
      }
    }
    return { complete: true, delivered, changed: [...changed] };
  });
}
