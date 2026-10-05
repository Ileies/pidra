/**
 * Which routes the offline layer serves from the mirror, and how the service worker recognises
 * them. Split out of `routes.ts` so the worker imports this and not the navigation registry.
 */

/**
 * The mirrored tier (docs/offline-mode.md), per SvelteKit route id, not per nav entry (`/[date]` is
 * mirrored while its child `/[date]/triage` is live). The other tiers are `ONLINE_ONLY`
 * (`onlineOnly.ts`) and `STATIC_OFFLINE_ROUTES`. scripts/check-offline.ts fails the build when a
 * page is in no list, or a mirrored page has a server load or is not `ssr = false`.
 *
 * Mirrored routes are client-rendered, so the server returns one route-agnostic HTML shell for all
 * of them; `hooks.server.ts` marks it and the service worker keeps the newest as the offline boot
 * document.
 */
export const MIRRORED_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/[date]",
  "/[date]/detail/[ids]",
  "/notes",
  "/context-builder",
  "/context-builder/corrections",
  "/entities",
  "/entities/[id]",
  "/contacts",
  "/topics",
  "/settings",
]);

/**
 * What a route parameter of a mirrored route matches, for the service worker, which sees paths and
 * not route ids. It has to be as strict as the page is: `/[date]` as `[^/]+` would also match
 * `/sources`, and serve that live page the shell cache-first. Anything not listed is one segment.
 */
const PARAM_PATTERNS: Record<string, string> = { date: "\\d{4}-\\d{2}-\\d{2}" };

const MIRRORED_PATTERNS = [...MIRRORED_ROUTES].map(
  (id) => new RegExp(`^${id.replace(/\[([^\]]+)\]/g, (_, name: string) => PARAM_PATTERNS[name] ?? "[^/]+")}/?$`),
);

/** True for a pathname that resolves to a mirrored route, so its document is the shell. */
export function isMirroredPath(pathname: string): boolean {
  return MIRRORED_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** Public, static documents. SvelteKit prerenders them and the service worker precaches them. */
export const STATIC_OFFLINE_ROUTES: ReadonlySet<string> = new Set(["/privacy", "/terms"]);
