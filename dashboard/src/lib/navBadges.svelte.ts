/**
 * The navbar and tab bar badges (`GET /api/nav-badges`: unread reports, open questions, run
 * issues, pending approvals), fetched in the background so nothing waits on them: badges render
 * as none until the count arrives.
 *
 * `refresh()` is called by the root layout whenever page data reloads (navigation, a form
 * action's invalidation) and by `useReadReceipt` after the read receipt; it is throttled to once
 * per 5 s, one request at a time. Hidden while offline: a count that cannot be checked is not
 * shown as if it were current.
 */

import { netJson } from "#lib/offline/net.js";
import { offline } from "#lib/offline/state.svelte.js";

const MIN_INTERVAL_MS = 5_000;

class NavBadges {
  #counts = $state<Record<string, number>>({});
  #inFlight = false;
  #lastAt = 0;

  /** Keyed by href, so the navbar renders a badge without knowing what it counts. */
  get counts(): Record<string, number> {
    return offline.isOffline ? {} : this.#counts;
  }

  async refresh(): Promise<void> {
    if (this.#inFlight || Date.now() - this.#lastAt < MIN_INTERVAL_MS) return;
    this.#inFlight = true;
    this.#lastAt = Date.now();
    try {
      const body = await netJson<{ navBadges: Record<string, number> }>("/api/nav-badges");
      this.#counts = body.navBadges ?? {};
    } catch {
      // Offline or slow: keep what was there; `counts` hides it while offline.
    } finally {
      this.#inFlight = false;
    }
  }
}

export const navBadges = new NavBadges();
