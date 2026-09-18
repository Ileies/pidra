/**
 * Pulls the offline snapshot and writes it into the mirror (OFFLINE_PLAN.md §5-§6). Idempotent and
 * safe to call from anywhere - `repo.ts` calls it before every read, the service worker's `push`
 * handler will call it on delivery once O3 lands, and later a manual "Sync now" reuses the same
 * function.
 *
 * Full replace, not delta: every call overwrites each store with exactly what the snapshot
 * contains and prunes anything mirrored that the snapshot no longer lists (`db.pruneToIds`). At the
 * measured size (OFFLINE_PLAN.md §4) that is cheap enough to do on every sync, and it makes
 * deletions free - a row missing from the response is gone from the mirror without the server
 * having to track a tombstone list.
 *
 * `flush()` runs first so a snapshot never overwrites a write with the pre-write state the server
 * had a moment ago, and `reapplyPending()` runs after so anything that still could not flush -
 * offline the whole time, or a transport failure right in this same call - is re-asserted on top
 * of what the pull just brought back, rather than looking discarded until it eventually lands.
 */

import * as db from "./db.js";
import * as outbox from "./outbox.js";

export type SyncResult = "synced" | "offline";

const DEFAULT_TIMEOUT_MS = 8000;

export async function pull(options: { timeoutMs?: number } = {}): Promise<SyncResult> {
  await outbox.flush().catch(() => {});

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/offline/snapshot", { signal: controller.signal });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const snapshot = (await res.json()) as Snapshot;
    await applySnapshot(snapshot);
    await outbox.reapplyPending();
    return "synced";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLastSyncedAt(): Promise<string | null> {
  const row = await db.get<{ id: string; value: string }>("meta", "lastSyncedAt");
  return row?.value ?? null;
}

interface Snapshot {
  version: string;
  generatedAt: string;
  stores: {
    reports: { id: string }[];
    extractions: { id: string }[];
    notes: { id: string }[];
    rules: { id: string }[];
    corrections: { id: string }[];
    contextDoc: { id: string } | null;
  };
}

async function applySnapshot(snapshot: Snapshot): Promise<void> {
  // A build the client has never seen invalidates whatever it had cached, rather than merging
  // across a possible schema change (OFFLINE_PLAN.md §5). Never touches "outbox"/"failed" - those
  // hold real queued writes, not mirrored server state.
  const storedVersion = await db.get<{ id: string; value: string }>("meta", "mirrorVersion");
  if (storedVersion && storedVersion.value !== snapshot.version) {
    for (const store of ["reports", "extractions", "notes", "rules", "corrections", "contextDoc"] as const) {
      await db.clear(store);
    }
  }

  await db.bulkPut("reports", snapshot.stores.reports);
  await db.bulkPut("extractions", snapshot.stores.extractions);
  await db.bulkPut("notes", snapshot.stores.notes);
  await db.bulkPut("rules", snapshot.stores.rules);
  await db.bulkPut("corrections", snapshot.stores.corrections);
  if (snapshot.stores.contextDoc) await db.put("contextDoc", snapshot.stores.contextDoc);

  await db.pruneToIds("reports", snapshot.stores.reports.map((r) => r.id));
  await db.pruneToIds("extractions", snapshot.stores.extractions.map((r) => r.id));
  await db.pruneToIds("notes", snapshot.stores.notes.map((r) => r.id));
  await db.pruneToIds("rules", snapshot.stores.rules.map((r) => r.id));
  await db.pruneToIds("corrections", snapshot.stores.corrections.map((r) => r.id));

  await db.put("meta", { id: "lastSyncedAt", value: snapshot.generatedAt });
  await db.put("meta", { id: "mirrorVersion", value: snapshot.version });
}
