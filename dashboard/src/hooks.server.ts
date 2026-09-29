import type { Handle } from "@sveltejs/kit/hooks";
import { building, dev } from "$app/env";
import { installShutdownHandlers } from "#lib/server/shutdown.js";
import { MIRRORED_ROUTES } from "#lib/routes.js";
import { SESSION_COOKIE, validateSession } from "#lib/server/auth.js";

// SvelteKit imports this module once, when the server starts, which is the only place in the
// dashboard that runs before the first request. Dev keeps Vite's own signal handling and the
// build step must not install a process handler at all, so both are skipped.
if (!building && !dev) installShutdownHandlers();

/**
 * The auth gate. `pidra.de` is public now (nginx no longer restricts it to wg0), so this
 * is the only thing standing between the open internet and the briefing archive - CLAUDE.md's
 * "no auth in front of the dashboard" is exactly the precondition this closes.
 *
 * A hard-coded allowlist rather than a per-route flag: the failure mode of a route falling
 * through the gate by omission (a new page, a typo) must be "requires login", never "public".
 * `/setup` is deliberately on this list although it is not truly public - it self-gates inside
 * the route (the setup token before any credential exists, `locals.session` after).
 */
const PUBLIC_EXACT = new Set(["/login", "/setup", "/privacy", "/terms", "/manifest.webmanifest", "/service-worker.js", "/api/health"]);
const PUBLIC_PREFIXES = ["/_app/", "/icons/", "/api/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Two stamps, both for the offline layer (CLAUDE.md, Offline mode):
 *
 * - `x-pidra` on every response this process serves. When pronix does not answer, the answer to a
 *   request can come from someone else - nginx's 403 on the public path, a captive portal - and the
 *   client and the worker treat a response without the stamp as "pronix was not reached".
 * - `x-pidra-shell` on the HTML of a mirrored route. Those are `ssr = false`, so the document is
 *   the same route-agnostic shell for all of them, and the worker keeps the newest one to boot any
 *   path from when the network does not answer.
 */

// Set only by `scripts/blackhole/run.ts`'s own server spawn, never in a deployed environment: that
// suite points `DATABASE_URL` at a closed port on purpose (everything it reads comes from the
// fixture, nothing may write), so `validateSession` can never succeed there regardless of cookie.
// Its lanes drive the offline layer, not the login flow, so a stubbed session sits alongside the
// closed DB and the closed skills bridge as one more thing that suite deliberately does not touch.
const BLACKHOLE_TEST = process.env.PIDRA_BLACKHOLE_TEST === "1";

export const handle: Handle = async ({ event, resolve }) => {
  // The build's own prerender crawl runs every route through this hook with no real request or
  // cookies behind it. A redirect returned there is not a live 303 - SvelteKit bakes it into a
  // static file that then answers every future request for that path, session or not, since a
  // prerendered file bypasses this hook entirely. The gate has nothing to decide until a real
  // request exists, so it sits out the build rather than freezing "logged out" forever.
  event.locals.session = building
    ? null
    : BLACKHOLE_TEST
      ? { id: "blackhole-test" }
      : await validateSession(event.cookies.get(SESSION_COOKIE));

  if (!building && !event.locals.session && !isPublic(event.url.pathname)) {
    if (event.url.pathname.toLowerCase().startsWith("/api/")) {
      return stamp(Response.json({ error: "unauthorized" }, { status: 401 }), false);
    }
    // Not `.search` too: SvelteKit forbids reading it while prerendering (a canonical-output
    // guard), and the build's own link crawl reaches every non-prerendered route regardless.
    const redirect = `/login?redirect=${encodeURIComponent(event.url.pathname)}`;
    return stamp(new Response(null, { status: 303, headers: { location: redirect } }), false);
  }

  // A universal load's fetch during server rendering is inlined into the page and replayed on
  // hydration with its headers filtered; the stamp has to survive that, or the first load after a
  // server-rendered page would read its own replayed answer as "not pronix".
  const response = await resolve(event, { filterSerializedResponseHeaders: (name) => name === "x-pidra" });
  const shell =
    !event.isDataRequest &&
    MIRRORED_ROUTES.has(event.route.id ?? "") &&
    (response.headers.get("content-type") ?? "").includes("text/html");
  return stamp(response, shell);
};

/**
 * Defense in depth beyond the login gate itself: the dashboard is internet-facing now and renders
 * model-derived HTML on almost every page (`renderMarkdown()`, `$lib/markdown.ts`). DOMPurify
 * there is the real sanitiser; these headers are the backstop if that pipeline ever regresses,
 * plus unconditional clickjacking protection on every write action (delete a note, revoke a
 * session, run a skill) - none of which has a confirmation step beyond the click itself.
 *
 * `RESOURCE_CSP` stays Report-Only for now: every asset in this app is self-hosted (fonts, icons,
 * `_app/immutable`, `sw-migration.js`), so it should already be clean, but it is the one set of
 * directives that can silently break a feature rather than fail loudly - flip `CSP_REPORT_ONLY` to
 * `false` once a day of real browser use shows no console violations.
 *
 * Only reaches responses that pass through this hook - a truly prerendered page (`/privacy`,
 * `/terms`) is served by adapter-node's static file server and never runs `handle` at all, the
 * same gap the docblock above already calls out for the login gate.
 */
const CSP_REPORT_ONLY = true;

/**
 * `app.html`'s one inline script (the service-worker migration, kept inline rather than a
 * `<script src>` so it costs no separate network round trip - see the comment beside it). A
 * strict `script-src` has to allowlist it by content hash; if that script's text ever changes,
 * this hash needs regenerating (`sha256sum` the exact text between the tags, base64-encode the
 * digest) or `CSP_REPORT_ONLY` will start logging a violation for it - which is the point: it
 * surfaces a stale hash before anyone flips this to enforcing.
 */
const INLINE_SW_MIGRATION_HASH = "'sha256-Voat3aUhvKNrqeBzYGoQdZqdKoW30wLAQWlsesfoaMc='";

const RESOURCE_CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SW_MIGRATION_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
].join("; ");

function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()");
  // Always enforced: zero compatibility risk, nothing here legitimately frames this app, loads a
  // plugin, or needs to change <base>.
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
