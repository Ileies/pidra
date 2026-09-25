import type { LayoutLoad } from "./$types";
import { netJson } from "#lib/offline/net.js";

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
 * (Navbar.svelte, TabBar.svelte) already treat a missing navBadges as no badges. Known offline,
 * `netJson` fails in the same frame; H2 (OFFLINE_PLAN.md §14.3) takes this off the load path.
 * The load's own `fetch` is passed through because this also runs during server rendering of
 * the pages that still have it, where a relative URL needs SvelteKit's fetch.
 */
export const load: LayoutLoad = async ({ fetch }) => {
  try {
    return await netJson<{ hasPendingQuestions: boolean; navBadges: Record<string, number> }>("/api/nav-badges", {}, { budgetMs: 4000, fetch });
  } catch {
    return { hasPendingQuestions: false, navBadges: {} as Record<string, number> };
  }
};
