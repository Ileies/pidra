import type { Handle } from "@sveltejs/kit/hooks";
import { building, dev } from "$app/env";
import { installShutdownHandlers } from "#lib/server/shutdown.js";
import { MIRRORED_ROUTES } from "#lib/offline/tiers.js";
import { SESSION_COOKIE, validateSession } from "#lib/server/auth.js";

/*
 * Server hooks, in order: shutdown handlers (module load), the auth gate, the offline stamps
 * (`x-pidra`, `x-pidra-shell`; read by `lib/offline/net.ts`, `guard.ts` and `sw/cache.ts`) and the
 * security headers. Sessions: `lib/server/auth.ts`.
 */

// Module load runs once at server start, before any request. Skipped in dev (Vite handles
// signals) and during the build (must not install a process handler).
if (!building && !dev) installShutdownHandlers();

/**
 * The auth gate: `pidra.de` is public, so this is all that stands between the internet and the
 * briefing archive. A hard-coded allowlist rather than a per-route flag, so a route that falls
 * through by omission (new page, typo) is "requires login", never "public". `/setup` is listed
 * although not truly public: it self-gates inside the route (setup token before any credential
 * exists, `locals.session` after).
 */
const PUBLIC_EXACT = new Set(["/login", "/setup", "/privacy", "/terms", "/manifest.webmanifest", "/service-worker.js", "/api/health"]);
const PUBLIC_PREFIXES = ["/_app/", "/icons/", "/api/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

// Set only by scripts/blackhole/run.ts's server spawn, never deployed: that suite points
// `DATABASE_URL` at a closed port, so `validateSession` could never succeed; a stub session
// stands in because its lanes test the offline layer, not login.
const BLACKHOLE_TEST = process.env.PIDRA_BLACKHOLE_TEST === "1";

export const handle: Handle = async ({ event, resolve }) => {
  // The gate sits out the prerender crawl: a redirect returned there would be baked into a static
  // file that answers every future request for that path, session or not.
  event.locals.session = building
    ? null
    : BLACKHOLE_TEST
      ? { id: "blackhole-test" }
      : await validateSession(event.cookies.get(SESSION_COOKIE));

  if (!building && !event.locals.session && !isPublic(event.url.pathname)) {
    if (event.url.pathname.toLowerCase().startsWith("/api/")) {
      return stamp(Response.json({ error: "unauthorized" }, { status: 401 }), false);
    }
    // Not `.search`: SvelteKit forbids reading it while prerendering.
    const redirect = `/login?redirect=${encodeURIComponent(event.url.pathname)}`;
    return stamp(new Response(null, { status: 303, headers: { location: redirect } }), false);
  }

  // Server-rendered loads are replayed on hydration with headers filtered; `x-pidra` must survive
  // or the client would read its own replayed answer as "not pronix".
  const response = await resolve(event, { filterSerializedResponseHeaders: (name) => name === "x-pidra" });
  // `x-pidra-shell` marks the HTML of a mirrored route (ssr = false, so one document for all);
  // the worker caches the newest as its offline boot document.
  const shell =
    !event.isDataRequest &&
    MIRRORED_ROUTES.has(event.route.id ?? "") &&
    (response.headers.get("content-type") ?? "").includes("text/html");
  return stamp(response, shell);
};

/**
 * Defense in depth: the dashboard is internet-facing and renders model-derived HTML (DOMPurify in
 * `$lib/markdown.ts` is the real sanitiser; these headers are the backstop) and write actions have
 * no confirmation beyond the click, hence unconditional clickjacking protection.
 *
 * `RESOURCE_CSP` stays Report-Only because it can silently break a feature: flip `CSP_REPORT_ONLY`
 * to `false` after a day of real use shows no console violations.
 *
 * Prerendered pages (`/privacy`, `/terms`) are served by adapter-node's static server and bypass
 * this hook entirely, so they get neither the gate nor these headers.
 */
const CSP_REPORT_ONLY = true;

/**
 * Hash of `app.html`'s inline service-worker registration script. Every inline script's hash must
 * be regenerated when its text changes (sha256 of the exact text between the tags, base64), or
 * `CSP_REPORT_ONLY` logs a violation; enforcing mode would block the script.
 */
const INLINE_SW_REGISTER_HASH = "'sha256-irp4nRjMQ4b/OArOsq5FzDBOYQAKoTeWljraTc8xqrA='";

/** Hash of `app.html`'s inline script that stashes `beforeinstallprompt`. */
const INLINE_INSTALL_PROMPT_HASH = "'sha256-hquMtZi0IFK1YGzqBD29Px5iqPtAd2h7x8lFP6X67PU='";

/** Hash of `app.html`'s theme script (applies the stored light/system choice before first paint). */
const INLINE_THEME_HASH = "'sha256-C72l7v7bAGyNBfas58GpcwxS2axkSdhtuoECMO9yYlo='";

const RESOURCE_CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SW_REGISTER_HASH} ${INLINE_INSTALL_PROMPT_HASH} ${INLINE_THEME_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // The report player plays each spoken chapter from a blob URL it downloaded through net().
  "media-src 'self' blob:",
  "connect-src 'self'",
].join("; ");

function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()");
  // Always enforced: nothing legitimately frames the app, loads a plugin or changes <base>.
  headers.append("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  headers.append(CSP_REPORT_ONLY ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", RESOURCE_CSP);
}

function stamp(response: Response, shell: boolean): Response {
  const apply = (target: Response) => {
    target.headers.set("x-pidra", "1");
    if (shell) target.headers.set("x-pidra-shell", "1");
    applySecurityHeaders(target.headers);
    return target;
  };
  try {
    return apply(response);
  } catch {
    // A response passed through from `fetch` (the bridge proxies) has immutable headers.
    return apply(new Response(response.body, response));
  }
}
