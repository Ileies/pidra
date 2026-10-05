/**
 * Where the reader came from, for pages that are reachable from several places and would
 * otherwise hard-code one way back. Today that is the detail page behind a delivery: the report
 * links to it, and so do the source pages, feedback and triage.
 *
 * `record()` is fed by the root layout's `beforeNavigate`; pages read `back`.
 * Kept in memory on purpose. A reload, a new tab or a shared link loses it, and the page then
 * falls back to its default back link. The URL stays free of it, so the offline mirror and
 * service worker see one URL per page.
 */

import { routeFor } from "#lib/routes.js";

const DETAIL_ROUTE = "/[date]/detail/[ids]";

interface BackLink {
  href: string;
  label: string;
}

class NavOrigin {
  #previous = $state<{ url: URL; routeId: string | null } | null>(null);

  /** Called for every in-app navigation, before it happens, with the page being left. */
  record(from: { url: URL; routeId: string | null }, to: URL): void {
    if (from.url.pathname === to.pathname) return;
    // Detail to detail would erase the real origin, so it is never an origin itself.
    if (from.routeId === DETAIL_ROUTE) return;
    this.#previous = from;
  }

  /** The page the reader came from, or null on a cold load. */
  get back(): BackLink | null {
    const previous = this.#previous;
    if (!previous) return null;
    const { url, routeId } = previous;
    const href = url.pathname + url.search;
    if (routeId === "/[date]") return { href, label: url.pathname.slice(1) || "Report" };
    if (routeId === "/sources/[name]") {
      const name = url.pathname.split("/")[2] ?? "";
      try {
        return { href, label: decodeURIComponent(name) };
      } catch {
        return { href, label: "Source" };
      }
    }
    const label = routeFor(routeId)?.label;
    return label ? { href, label } : null;
  }
}

export const navOrigin = new NavOrigin();
