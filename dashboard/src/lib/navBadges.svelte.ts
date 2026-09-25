/**
 * The navbar and tab bar badges (pending question gate, pending approvals), fetched in the
 * background (OFFLINE_PLAN.md §14.3, H2). They used to be the root layout's load, which every cold
 * start awaited for up to 4 s before the first page could render, offline included. Now nothing
 * waits: the badges render as none until the count arrives.
 *
 * Refreshed whenever the page's data reloads - a navigation, or a form action's invalidation on
 * `/skills` or `/questions`, which is exactly when a count can have moved - at most every few
 * seconds and one request at a time. Hidden while offline: a count that cannot be checked is not
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
    return offline.reachable === "offline" ? {} : this.#counts;
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
