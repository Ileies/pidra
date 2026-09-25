/**
 * The write path (OFFLINE_PLAN.md §6), as the pages see it. A page never writes the mirror
 * directly (§3, decision 3): it calls one of the functions below, which appends an intent, applies
 * its effect to the mirror optimistically, and tries to flush. `sync.ts` is the only other writer
 * of the mirror, and it calls `flush()` before every pull and `reapplyPending()` after, so a write
 * still queued when a pull lands is not clobbered by what the pull brings back.
 *
 * What an intent is and how the queue drains lives in `intents.ts`, which the service worker runs
 * too (H3): a write that could not go out is handed to Background Sync where the browser has it,
 * so it can land with the app closed, and the worker drains the same queue on the morning push.
 */

import * as db from "./db.js";
import { net, NetError } from "./net.js";
import { invalidateMirror } from "./deps.js";
import { applyOptimistic, drain, sortedOutbox, storesOf, type Intent, type IntentKind, type NotePatchPayload } from "./intents.js";
import type { NoteRow } from "#lib/notes/api.js";

export type { Intent, IntentKind } from "./intents.js";
export { reapplyPending, INTENT_LABEL, intentIsFor, intentSummary } from "./intents.js";

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

/** Also called by `state.svelte.ts` when the worker drained the queue behind the page's back. */
export function notify(): void {
  for (const listener of listeners) listener();
}

// --- enqueue ---

/**
 * Resolves once the page shows the write (OFFLINE_PLAN.md §14.3, H2): the optimistic effect is in
 * the mirror and the loads that read it have re-run from it. The flush that sends it runs behind,
 * so the network is never between the tap and the re-render - a page used to `refreshAll()` here,
 * which re-ran every load up to the root layout and, before H2, a full snapshot pull with them.
 */
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
  // Best effort; failures stay queued and the caller never waits on them. Whatever is still queued
  // afterwards is handed to the worker, so it does not wait for the app to be opened again.
  flush()
    .then(async () => {
      if ((await sortedOutbox()).length > 0) await requestBackgroundFlush();
    })
    .catch(() => {});
  await invalidateMirror(storesOf(kind));
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
  for (const store of ["outbox", "failed"] as const) {
    for (const intent of await db.getAll<Intent>(store)) {
      if (intent.kind === "rate" && (intent.payload as { extractionId: string }).extractionId === extractionId) {
        await db.del(store, intent.id);
      }
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

let flushing: Promise<void> | null = null;

/**
 * Drains the outbox through `net()` (see `drain` in `intents.ts` for the ordering rules). Safe to
 * call whenever: on its own it is a no-op with an empty queue, and concurrent calls (an enqueue, a
 * `visibilitychange`, a `sync()`) share one in-flight run rather than racing.
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

export async function failed(): Promise<Intent[]> {
  const all = await db.getAll<Intent>("failed");
  return all.sort((a, b) => a.seq - b.seq);
}

/** Re-queues a failed intent at the tail - not back in its original position, because whatever
 *  was behind it has long since flushed - and tries again immediately. Re-applied to the mirror
 *  first: a full pull since the failure has usually taken its effect out of the row. */
export async function retryFailed(id: string): Promise<void> {
  const intent = await db.get<Intent>("failed", id);
  if (!intent) return;
  await db.del("failed", id);
  const requeued = { ...intent, seq: await nextSeq(), attempts: 0, lastError: null };
  await applyOptimistic(requeued);
  await db.put("outbox", requeued);
  notify();
  flush().catch(() => {});
  await invalidateMirror(storesOf(intent.kind));
}

export async function discardFailed(id: string): Promise<void> {
  await db.del("failed", id);
  notify();
}
