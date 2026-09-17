import type { LayoutLoad } from "./$types";

/**
 * Replaces +layout.server.ts (OFFLINE_PLAN.md O2). The root layout wraps every route, so a server
 * load here forced a __data.json round trip on every client-side navigation - even to a Tier A
 * page whose own load has since gone client-only (`ssr = false`), which defeats decision 1: one
 * cached shell can only boot any Tier A path offline if nothing above it in the route tree still
 * needs the network. Verified against node_modules/@sveltejs/kit/src/runtime/client/client.js: a
 * node's server-load-ness is a static per-node flag baked in at build time, independent of a
 * descendant leaf's `ssr` export.
 *
 * Badge counts degrade to empty/false when the endpoint is unreachable. Both consumers
 * (Navbar.svelte, TabBar.svelte) already treat a missing navBadges as no badges.
 */
export const load: LayoutLoad = async ({ fetch }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch("/api/nav-badges", { signal: controller.signal });
    if (!res.ok) throw new Error(`nav-badges ${res.status}`);
    return (await res.json()) as { hasPendingQuestions: boolean; navBadges: Record<string, number> };
  } catch {
    return { hasPendingQuestions: false, navBadges: {} as Record<string, number> };
  } finally {
    clearTimeout(timeout);
  }
};
