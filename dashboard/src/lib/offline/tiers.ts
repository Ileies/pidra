/**
 * Which routes the offline layer serves from the mirror, and how the service worker recognises
 * them. Split out of `routes.ts` so the worker imports this and not the navigation registry.
 */

/**
 * The offline tiers (CLAUDE.md, Offline mode), per SvelteKit route id rather than per nav entry:
 * `/[date]` reads the mirror while its child `/[date]/triage` is live, so the entry is the wrong
 * grain. `dashboard/scripts/check-offline.ts` fails the build when a page is in neither list, and
 * when a mirrored page still has a server load or is not `ssr = false`.
 *
 * Mirrored routes are client-rendered, so the HTML the server returns for any of them is the same
 * route-agnostic shell. `hooks.server.ts` marks those responses and the service worker keeps the
 * newest one as the document it boots any path from when the network cannot answer.
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
