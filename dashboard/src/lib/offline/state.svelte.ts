/**
 * The header dot and the sync sheet's state (OFFLINE_PLAN.md O4, §8-§9). Reachability, not
 * `navigator.onLine`: that event only reports the WiFi link, and the failure this whole feature
 * exists for is WiFi up, wg0 down (§0). `GET /api/health` is the real signal - reaching the
 * dashboard process is exactly what the VPN gates - probed on a schedule that backs off rather
 * than hammering an origin that is genuinely unreachable:
 *
 * - on start, on the `online` event, and whenever the tab becomes visible again;
 * - `navigator.onLine === false` still short-circuits straight to offline without a probe - a
 *   free, instant negative that a real request would only be slower to reach the same way;
 * - every 60s while visible and believed offline, backing off to 5 minutes after the third
 *   consecutive failure, and not polling at all while hidden;
 * - two consecutive failures are what flip the dot to offline, one success flips it back, so one
 *   slow response does not make the indicator flap.
 */

import { browser } from "$app/env";
import * as db from "./db.js";
import * as outbox from "./outbox.js";
import { pull, getLastSyncedAt } from "./sync.js";

export type Reachability = "checking" | "online" | "offline";

const PROBE_TIMEOUT_MS = 3000;
const POLL_MS = 60_000;
const POLL_BACKOFF_MS = 300_000;
const BACKOFF_AFTER = 3;

class OfflineState {
  reachable = $state<Reachability>("checking");
  lastSyncedAt = $state<string | null>(null);
  mirroredReportCount = $state(0);
  oldestMirroredDate = $state<string | null>(null);
  pending = $state<outbox.Intent[]>([]);
  failed = $state<outbox.Intent[]>([]);
  sheetOpen = $state(false);
  syncing = $state(false);

  #started = false;
  #consecutiveFailures = 0;
  #pollTimer: ReturnType<typeof setTimeout> | undefined;

  get queuedCount(): number {
    return this.pending.length;
  }

  /** Called once from the root layout, client only. */
  start(): void {
    if (this.#started || !browser) return;
    this.#started = true;

    this.refresh();
    this.probe();

    outbox.onChange(() => this.refresh());
    window.addEventListener("online", () => this.probe());
    window.addEventListener("offline", () => {
      this.reachable = "offline";
      this.#reschedule();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTimeout(this.#pollTimer);
      } else {
        this.probe();
        this.refresh();
      }
    });
  }

  async refresh(): Promise<void> {
    const [pending, failed, lastSyncedAt, reports] = await Promise.all([
      outbox.pending(),
      outbox.failed(),
      getLastSyncedAt(),
      db.getAll<{ id: string; date: string }>("reports"),
    ]);
    this.pending = pending;
    this.failed = failed;
    this.lastSyncedAt = lastSyncedAt;
    this.mirroredReportCount = reports.length;
    this.oldestMirroredDate = reports.map((r) => r.date).sort()[0] ?? null;
  }

  async probe(): Promise<boolean> {
    if (!navigator.onLine) {
      this.#onFailure();
      return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
      if (res.ok) {
        this.#onSuccess();
        return true;
      }
      this.#onFailure();
      return false;
    } catch {
      this.#onFailure();
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  #onSuccess(): void {
    this.#consecutiveFailures = 0;
    this.reachable = "online";
    this.#reschedule();
  }

  #onFailure(): void {
    this.#consecutiveFailures += 1;
    if (this.reachable !== "offline" && (this.reachable === "checking" || this.#consecutiveFailures >= 2)) {
      this.reachable = "offline";
    }
    this.#reschedule();
  }

  #reschedule(): void {
    if (!browser || document.hidden) return;
    clearTimeout(this.#pollTimer);
    const delay = this.#consecutiveFailures >= BACKOFF_AFTER ? POLL_BACKOFF_MS : POLL_MS;
    this.#pollTimer = setTimeout(() => this.probe(), delay);
  }

  /** The sync sheet's "Sync now" - a manual pull outside the read path's own background one. */
  async syncNow(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      await pull();
      await this.refresh();
      await this.probe();
    } finally {
      this.syncing = false;
    }
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
    for (const store of ["reports", "extractions", "notes", "rules", "corrections", "contextDoc", "meta"] as const) {
      await db.clear(store);
    }
    await this.refresh();
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
