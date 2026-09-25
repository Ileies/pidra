import type { Handle } from "@sveltejs/kit/hooks";
import { building, dev } from "$app/env";
import { installShutdownHandlers } from "#lib/server/shutdown.js";
import { MIRRORED_ROUTES } from "#lib/routes.js";

// SvelteKit imports this module once, when the server starts, which is the only place in the
// dashboard that runs before the first request. Dev keeps Vite's own signal handling and the
// build step must not install a process handler at all, so both are skipped.
if (!building && !dev) installShutdownHandlers();

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
