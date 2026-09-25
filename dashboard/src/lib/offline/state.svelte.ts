/**
 * The header dot and the sync sheet's state (OFFLINE_PLAN.md O4, §8-§9, §14). Reachability itself
 * is decided in `net.ts`, by the requests that actually go out: the first version decided it here
 * from a separate `/api/health` schedule, which is how a Questions tap could fail on a dead
 * network while this still said "online" (§14.1). This class mirrors that verdict into runes for
 * the UI and owns the one thing `net.ts` cannot do from inside a request: find the way back.
 *
 * While offline and visible, it probes every 20 s, backing off to a minute after ten failures in a
 * row, and never while hidden. It also probes on the `online` event and whenever the app comes
 * back to the foreground. `navigator.onLine === false` is still a free, certain negative.
 *
 * It also owns when a sync is *forced* past the one-a-minute throttle in `sync.ts` (§14.3, H2): at
 * app start, and when the app comes back to the foreground after more than five minutes away.
 * Every other sync is the background one a page read starts, which the throttle absorbs.
 */

import { browser } from "$app/env";
import * as db from "./db.js";
import * as outbox from "./outbox.js";
import * as net from "./net.js";
import { getLastSyncedAt, onSync, sync, type SyncResult } from "./sync.js";
import { invalidateMirror, MIRROR_STORES } from "./deps.js";

export type { Reachability } from "./net.js";
import type { Reachability } from "./net.js";

const POLL_MS = 20_000;
const POLL_BACKOFF_MS = 60_000;
const BACKOFF_AFTER = 10;
/** Hidden for longer than this, coming back counts as a new start and syncs past the throttle. */
const RESUME_SYNC_AFTER_MS = 5 * 60_000;

class OfflineState {
  reachable = $state<Reachability>("checking");
  lastSyncedAt = $state<string | null>(null);
  mirroredReportCount = $state(0);
  oldestMirroredDate = $state<string | null>(null);
  pending = $state<outbox.Intent[]>([]);
  failed = $state<outbox.Intent[]>([]);
  sheetOpen = $state(false);
  /** A pull is running, whoever started it. */
  syncing = $state(false);
  /** How the last pull that reached a verdict ended; null before the first one. */
  lastResult = $state<SyncResult | null>(null);
  /** Whether the browser promised not to evict the mirror and the outbox. Null: not known. */
  persisted = $state<boolean | null>(null);

  #started = false;
  #consecutiveFailures = 0;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;
  #hiddenAt = 0;

  get queuedCount(): number {
    return this.pending.length;
  }

  /** Called once from the root layout, client only. */
  start(): void {
    if (this.#started || !browser) return;
    this.#started = true;

    this.reachable = net.reachability();
    net.onReachability((next) => {
      this.reachable = next;
      if (next === "online") {
        this.#consecutiveFailures = 0;
        // Whatever was queued while the connection was gone can go now, and the mirror can catch
        // up on what happened meanwhile (throttled: a flapping link does not pull every time).
        outbox.flush().catch(() => {});
        void sync();
      }
      this.#reschedule();
    });
    onSync((event) => {
      this.syncing = event.phase === "start";
      if (event.phase === "end") {
        if (event.result !== "skipped") this.lastResult = event.result;
        this.refresh();
      }
    });
    this.#reschedule();
    this.refresh();
    void sync({ force: true });

    outbox.onChange(() => this.refresh());
    const probeAndReschedule = () => this.probe().then(() => this.#reschedule());
    window.addEventListener("online", probeAndReschedule);
    window.addEventListener("offline", () => net.markOffline());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.#hiddenAt = Date.now();
        clearTimeout(this.#pollTimer);
      } else {
        const longAway = this.#hiddenAt > 0 && Date.now() - this.#hiddenAt > RESUME_SYNC_AFTER_MS;
        probeAndReschedule().then(() => void sync({ force: longAway }));
        this.refresh();
      }
    });
  }

  async refresh(): Promise<void> {
    const [pending, failed, lastSyncedAt, reports, persisted] = await Promise.all([
      outbox.pending(),
      outbox.failed(),
      getLastSyncedAt(),
      db.getAll<{ id: string; date: string }>("reports"),
      navigator.storage?.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    this.pending = pending;
    this.failed = failed;
    this.lastSyncedAt = lastSyncedAt;
    this.mirroredReportCount = reports.length;
    this.oldestMirroredDate = reports.map((r) => r.date).sort()[0] ?? null;
    this.persisted = persisted;
  }

  async probe(): Promise<boolean> {
    const reached = await net.probe();
    if (!reached) this.#consecutiveFailures += 1;
    return reached;
  }

  /** Only offline needs a schedule: online, every request the app makes is a probe already. */
  #reschedule(): void {
    clearTimeout(this.#pollTimer);
    if (!browser || document.hidden || this.reachable !== "offline") return;
    const delay = this.#consecutiveFailures >= BACKOFF_AFTER ? POLL_BACKOFF_MS : POLL_MS;
    this.#pollTimer = setTimeout(async () => {
      await this.probe();
      this.#reschedule();
    }, delay);
  }

  /** "Sync now" and the first-sync state's Try again. Probes first, because while the state says
   *  offline `sync()` would not even try. `syncing` follows from the sync's own events. */
  async syncNow(): Promise<void> {
    if (this.syncing) return;
    if (await this.probe()) await sync({ force: true });
    await this.refresh();
  }

  async retryFailed(id: string): Promise<void> {
    await outbox.retryFailed(id);
  }

  async discardFailed(id: string): Promise<void> {
    await outbox.discardFailed(id);
  }

  /** Refuses while anything is queued (§9): wiping a queue that still holds a write nothing else
   *  has a copy of would lose it, not just the cache. */
  async clearMirror(): Promise<{ ok: boolean; reason?: string }> {
    if (this.pending.length > 0) return { ok: false, reason: "Writes are still queued - sync first." };
    for (const store of [...MIRROR_STORES, "meta"] as const) {
      await db.clear(store);
    }
    await this.refresh();
    // The page on screen was read from what just went; it shows the first-sync state instead.
    await invalidateMirror(["status", ...MIRROR_STORES]);
    return { ok: true };
  }

  toggleSheet(): void {
    this.sheetOpen = !this.sheetOpen;
  }

  closeSheet(): void {
    this.sheetOpen = false;
  }
}

export const offline = new OfflineState();
