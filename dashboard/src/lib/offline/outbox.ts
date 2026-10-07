/**
 * The write path as pages see it. A page never writes the mirror directly: it calls a function
 * below, which appends an intent to the IndexedDB `outbox` store, applies its effect to the mirror
 * optimistically and flushes in the background. `sync.ts` is the only other mirror writer; it
 * calls `flush()` before each pull and `reapplyPending()` after.
 *
 * Intent types and `drain` live in `intents.ts` (shared with the service worker, which drains the
 * same queue on Background Sync or push). Offline-only writes here are limited to notes and ratings;
 * everything else is online-only (see `onlineOnly.ts`).
 */

import * as db from "./db.js";
import { net, NetError } from "./net.js";
import { invalidateMirror } from "./deps.js";
import {
  applyOptimistic, drain, sortedIntents, sortedOutbox, storesOf,
  type Intent, type IntentKind, type NotePatchPayload, type Payloads,
} from "./intents.js";
import type { NoteRow } from "#lib/notes/api.js";
import type { NoteTargets } from "$pipeline/notes/steps";
import type { MirroredReport } from "#lib/mirror/types.js";

export type { Intent, IntentKind } from "./intents.js";
export { reapplyPending, INTENT_LABEL, intentIsFor, intentSummary } from "./intents.js";

/** `seq` orders the drain. Seeded from the queued rows so a reload does not restart at 0. */
let seqCounter: number | null = null;

async function nextSeq(): Promise<number> {
  if (seqCounter === null) {
    const existing = await db.getAll<Intent>("outbox");
    seqCounter = existing.reduce((max, i) => Math.max(max, i.seq), 0);
  }
  seqCounter += 1;
  return seqCounter;
}

/** Plain callbacks telling the header dot and sync sheet to re-read `pending()`/`failed()`;
 *  `state.svelte.ts` turns them into a re-render. */
const listeners = new Set<() => void>();

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Also called by `state.svelte.ts` when the worker drained the queue behind the page's back. */
export function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Resolves once the page shows the write (optimistic effect in the mirror, dependent loads re-run).
 * The flush runs behind, so the network is never between the tap and the re-render.
 */
async function enqueue<K extends IntentKind>(kind: K, payload: Payloads[K]): Promise<void> {
  await queue({
    id: crypto.randomUUID(),
    seq: await nextSeq(),
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  } as Intent);
}

async function queue(intent: Intent): Promise<void> {
  // Queued first: a snapshot pull that lands in between re-asserts queued intents, and would
  // otherwise overwrite the optimistic effect with pre-write server state.
  await db.put("outbox", intent);
  await applyOptimistic(intent);
  notify();
  // Best effort; failures stay queued. Leftovers go to the worker via Background Sync.
  flush()
    .then(async () => {
      if ((await sortedOutbox()).length > 0) await requestBackgroundFlush();
    })
    .catch(() => {});
  await invalidateMirror(storesOf(intent.kind));
}

/** Registration-side Background Sync, which lib.dom does not type. Chrome on Android has it;
 *  iOS Safari does not, and there the next app start or push drains the queue instead. */
interface SyncRegistration {
  sync?: { register(tag: string): Promise<void> };
}

async function requestBackgroundFlush(): Promise<void> {
  try {
    const registration = (await navigator.serviceWorker?.getRegistration()) as (ServiceWorkerRegistration & SyncRegistration) | undefined;
    await registration?.sync?.register("pidra-outbox");
  } catch {
    // Not supported, or refused. The queue still drains on the next start, foreground or push.
  }
}

export async function createNote(
  input: { content: string; scope?: string; expiresAt?: string | null; steps?: string[]; appliesTo?: NoteTargets | null; activeFrom?: string | null },
): Promise<void> {
  await enqueue("note.create", {
    id: crypto.randomUUID(),
    content: input.content,
    scope: input.scope ?? "global",
    expiresAt: input.expiresAt ?? null,
    ...(input.steps === undefined ? {} : { steps: input.steps }),
    ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
    ...(input.activeFrom === undefined ? {} : { activeFrom: input.activeFrom }),
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

/** A re-tap replaces any queued or failed rating for the same extraction instead of stacking.
 *  `drain` tolerates this happening while the old rating's request is in flight. */
export async function rate(extractionId: string, signal: "1" | "-1"): Promise<void> {
  for (const store of ["outbox", "failed"] as const) {
    for (const intent of await db.getAll<Intent>(store)) {
      if (intent.kind === "rate" && (intent.payload as { extractionId: string }).extractionId === extractionId) {
        await db.del(store, intent.id);
      }
    }
  }
  await enqueue("rate", { extractionId, signal });
}

/** Marks a report read on this device at once and on the server when the connection allows, so the
 *  state reaches every device through the next sync. No-op when the mirror already says read. */
export async function markReportRead(date: string): Promise<void> {
  const current = await db.get<MirroredReport>("reports", date);
  if (current?.readAt) return;
  for (const intent of await sortedOutbox()) {
    if (intent.kind === "report.read" && intent.payload.date === date) return;
  }
  await enqueue("report.read", { date });
}

let flushing: Promise<void> | null = null;

/**
 * Drains the outbox through `net()` (ordering rules: `drain` in `intents.ts`). Safe to call
 * anytime: no-op on an empty queue, concurrent calls share one run. Never rejects for offline.
 */
export function flush(): Promise<void> {
  flushing ??= drain((input, init) => net(input, init), {
    // Known offline: nothing left the device.
    notSent: (err) => err instanceof NetError && !err.sent,
    onChange: notify,
  })
    .then((result) => invalidateMirror(result.changed))
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

export async function pending(): Promise<Intent[]> {
  return sortedOutbox();
}

export function failed(): Promise<Intent[]> {
  return sortedIntents("failed");
}

/** Re-queues a failed intent at the tail - not back in its original position, because whatever
 *  was behind it has long since flushed - and tries again immediately. Re-applied to the mirror
 *  first: a full pull since the failure has usually taken its effect out of the row. */
export async function retryFailed(id: string): Promise<void> {
  const intent = await db.get<Intent>("failed", id);
  if (!intent) return;
  await db.del("failed", id);
  await queue({ ...intent, seq: await nextSeq(), attempts: 0, lastError: null });
}

export async function discardFailed(id: string): Promise<void> {
  await db.del("failed", id);
  notify();
}
