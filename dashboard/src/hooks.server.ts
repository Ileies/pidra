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
 * - `x-pidra` on every response this process serves. Without the VPN, the answer to a request
 *   can come from someone else - nginx's 403 on the public path, a captive portal - and the
 *   client and the worker treat a response without the stamp as "pronix was not reached".
 * - `x-pidra-shell` on the HTML of a mirrored route. Those are `ssr = false`, so the document is
 *   the same route-agnostic shell for all of them, and the worker keeps the newest one to boot any
 *   path from when the network does not answer.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.session = await validateSession(event.cookies.get(SESSION_COOKIE));

  if (!event.locals.session && !isPublic(event.url.pathname)) {
    if (event.url.pathname.startsWith("/api/")) {
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

function stamp(response: Response, shell: boolean): Response {
  const apply = (target: Response) => {
    target.headers.set("x-pidra", "1");
    if (shell) target.headers.set("x-pidra-shell", "1");
    return target;
  };
  try {
    return apply(response);
  } catch {
    // A response passed through from `fetch` (the bridge proxies) has immutable headers.
    return apply(new Response(response.body, response));
  }
}
