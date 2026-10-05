/**
 * The outbox's core, runnable by both pages and the service worker (`sw/sync.ts` drains the same
 * queue on push/Background Sync): intent types, their optimistic effect on the mirror, and `drain`.
 * Must not import `window`/SvelteKit code; the transport (`send`) is injected. `outbox.ts` is the
 * page API on top. Reads/writes IndexedDB stores `outbox`, `failed`, `notes`, `reports`,
 * `extractions`, `meta` (via `db.ts`). To add a write kind: extend `Payloads` and `KINDS`.
 *
 * `applyOptimistic` runs when an intent is queued and again after every pull (`reapplyPending`), so
 * it must be idempotent.
 */

import { jsonInit } from "#lib/http.js";
import { errMessage } from "$pipeline/util/text";
import * as db from "./db.js";
import type { MirrorStore } from "./db.js";
import type { NoteRow } from "#lib/notes/api.js";
import type { MirroredExtraction } from "./repo.js";
import type { Fetcher, MirroredReport } from "#lib/mirror/types.js";

/** `null` payloads for fields the caller left untouched: `content`/`scope` omitted means "leave
 *  it", `expiresAt` present-but-null means "clear it" - the same convention `NoteWrite` uses. */
export interface NotePatchPayload {
  content?: string;
  scope?: string;
  expiresAt?: string | null;
}

/** What each kind of write carries. Intents are persisted as-is in IndexedDB, so a change to a
 *  payload shape must stay readable for already-queued rows. */
export interface Payloads {
  "note.create": { id: string; content: string; scope: string; expiresAt: string | null };
  "note.update": { id: string; patch: NotePatchPayload; baseUpdatedAt: string | null };
  "note.delete": { id: string };
  "note.restore": { id: string };
  rate: { extractionId: string; signal: "1" | "-1" };
}

export type IntentKind = keyof Payloads;

interface IntentBase {
  id: string;
  seq: number;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

/** One queued write. Narrowing on `kind` narrows `payload`. */
export type Intent = { [K in IntentKind]: IntentBase & { kind: K; payload: Payloads[K] } }[IntentKind];

type Of<K extends IntentKind> = Extract<Intent, { kind: K }>;

/** One kind of write: UI label, mirror stores it touches, optimistic effect, delivering request. */
interface Handler<K extends IntentKind> {
  label: string;
  stores: MirrorStore[];
  /** Idempotent: it runs when the intent is queued and again after every pull. */
  apply(intent: Of<K>): Promise<void>;
  request(intent: Of<K>, send: Fetcher): Promise<Response>;
}

async function patchNote(id: string, change: (note: NoteRow) => Partial<NoteRow>): Promise<void> {
  const current = await db.get<NoteRow>("notes", id);
  // Absent for a created-then-deleted-then-reapplied race; nothing to patch onto.
  if (current) await db.put("notes", { ...current, ...change(current) });
}

const KINDS: { [K in IntentKind]: Handler<K> } = {
  "note.create": {
    label: "New note",
    stores: ["notes"],
    // A create is only ever re-applied (via reapplyPending) while still unflushed, so there is
    // nothing server-side yet to merge with - the same object every time is correct.
    apply: ({ payload: p, createdAt }) =>
      db.put<NoteRow>("notes", {
        id: p.id, content: p.content, scope: p.scope,
        created_at: createdAt, updated_at: null, expires_at: p.expiresAt,
        created_by: "user", updated_by: null, deleted_at: null, revision_count: 0,
      }),
    request: ({ payload: p }, send) =>
      send("/api/notes", jsonInit("POST", { id: p.id, content: p.content, scope: p.scope, expires_at: p.expiresAt })),
  },
  "note.update": {
    label: "Note edit",
    stores: ["notes"],
    apply: ({ payload: { id, patch }, createdAt }) =>
      patchNote(id, () => ({
        ...(patch.content === undefined ? {} : { content: patch.content }),
        ...(patch.scope === undefined ? {} : { scope: patch.scope }),
        ...("expiresAt" in patch ? { expires_at: patch.expiresAt ?? null } : {}),
        updated_at: createdAt,
        updated_by: "user",
      })),
    request: ({ payload: p }, send) =>
      send(`/api/notes/${p.id}`, jsonInit("PATCH", { ...p.patch, base_updated_at: p.baseUpdatedAt })),
  },
  "note.delete": {
    label: "Note deleted",
    stores: ["notes"],
    apply: ({ payload, createdAt }) =>
      patchNote(payload.id, () => ({ deleted_at: createdAt, updated_at: createdAt, updated_by: "user" })),
    request: ({ payload }, send) => send(`/api/notes/${payload.id}`, { method: "DELETE" }),
  },
  "note.restore": {
    label: "Note restored",
    stores: ["notes"],
    apply: ({ payload, createdAt }) =>
      patchNote(payload.id, () => ({ deleted_at: null, updated_at: createdAt, updated_by: "user" })),
    request: ({ payload }, send) => send(`/api/notes/${payload.id}/restore`, { method: "POST" }),
  },
  rate: {
    label: "Rating",
    stores: ["reports", "extractions"],
    apply: ({ payload: p }) => patchReportsRating(p.extractionId, p.signal === "1" ? "explicit_plus" : "explicit_minus"),
    request: ({ payload: p }, send) =>
      send("/api/feedback", jsonInit("POST", { extraction_id: p.extractionId, signal: p.signal })),
  },
};

/** The one place the kind-to-handler correlation is asserted, instead of in every switch. */
const handlerOf = (intent: Intent) => KINDS[intent.kind] as Handler<IntentKind>;

export const INTENT_LABEL = Object.fromEntries(
  Object.entries(KINDS).map(([kind, handler]) => [kind, handler.label]),
) as Record<IntentKind, string>;

/** The mirror stores an intent's optimistic effect writes, so exactly their loads re-run. */
export function storesOf(kind: IntentKind): MirrorStore[] {
  return KINDS[kind].stores;
}

function intentTarget(intent: Intent): string {
  const p = intent.payload;
  return "extractionId" in p ? p.extractionId : p.id;
}

/** Whether an intent writes a row of this kind with this id, which is where its state is shown. */
export function intentIsFor(intent: Intent, row: "note" | "rate", id: string): boolean {
  const family = intent.kind === "rate" ? "rate" : intent.kind.split(".")[0];
  return family === row && intentTarget(intent) === id;
}

/** Enough of the payload to say what changed, for a write whose row is not on screen. */
export function intentSummary(intent: Intent): string {
  if (intent.kind === "note.create") return intent.payload.content.slice(0, 60);
  const target = intentTarget(intent);
  return intent.kind === "rate" ? `extraction ${target.slice(0, 8)}…` : `${target.slice(0, 8)}…`;
}

export type { Fetcher };

export async function sortedIntents(store: "outbox" | "failed"): Promise<Intent[]> {
  return (await db.getAll<Intent>(store)).sort((a, b) => a.seq - b.seq);
}

export const sortedOutbox = () => sortedIntents("outbox");

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

export const applyOptimistic = (intent: Intent): Promise<void> => handlerOf(intent).apply(intent);

/**
 * Re-runs every still-pending intent's optimistic effect after a snapshot pull. A pull replaces
 * mirror rows from server state, which does not yet include unflushed intents; without this a
 * queued edit or rating would look discarded. Applies in `seq` order, like `drain()`.
 */
export async function reapplyPending(): Promise<void> {
  for (const intent of await sortedOutbox()) await applyOptimistic(intent);
}

/** Thrown for anything that will never succeed by retrying - a validation error, a 404 on a
 *  target that no longer exists. Distinct from a transport failure (offline, or the origin slow
 *  or unreachable), which is always retried. */
class TerminalError extends Error {}

async function deliver(intent: Intent, send: Fetcher): Promise<Response> {
  const res = await handlerOf(intent).request(intent, send);
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
  const current = await db.get<NoteRow>("notes", intent.payload.id);
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
 * Drains the outbox in `seq` order under the `pidra-outbox` lock (page and worker never double-send).
 * A transport failure stops the loop: a later intent may depend on an earlier one (edit of a note
 * still being created). A terminal failure (4xx) moves the intent to `failed` with payload intact
 * and continues, so one bad write cannot jam the queue.
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
        // scripts/blackhole), so each write below happens only if the intent is still queued, in
        // the same transaction as the check.
        if (err instanceof TerminalError) {
          const lastError = err.message;
          if (await db.move<Intent>("outbox", "failed", intent.id, (row) => ({ ...row, lastError }))) {
            // Its optimistic effect is still in the mirror and the server will never match it, so a
            // delta would never correct it either: without an ETag, the next sync is a full one.
            await db.del("meta", "etag");
            options.onChange?.();
          }
          continue;
        }
        // Nothing left the device, so it was not an attempt and says nothing new.
        if (!options.notSent?.(err)) {
          const lastError = errMessage(err);
          const noted = await db.update<Intent>("outbox", intent.id, (row) => ({ ...row, attempts: row.attempts + 1, lastError }));
          if (noted) options.onChange?.();
        }
        return { complete: false, delivered, changed: [...changed] };
      }
    }
    return { complete: true, delivered, changed: [...changed] };
  });
}
