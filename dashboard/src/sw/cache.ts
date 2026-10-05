/**
 * Precache, the shell and bounded navigations.
 *
 * **The shell, cache-first**. Mirrored routes are `ssr = false`, so the HTML the server returns for
 * any of them is the same route-agnostic document; `hooks.server.ts` marks it with `x-pidra-shell`.
 * A navigation to a mirrored path is answered from the cached shell straight away, online or not,
 * and the network only refreshes it in the background. Only a device with no shell yet goes to the
 * network first.
 *
 * **Everything else is bounded**. Offline is usually a blackhole, not an error, so a live page's
 * navigation races the network against `NAV_BUDGET_MS` and then boots the cached shell (its load
 * then fails into `OfflineNotice`), and an asset missing from the precache gets `ASSET_BUDGET_MS`.
 * `/api/**` and `__data.json` are not touched here: `$lib/offline/net.ts` bounds those in the page.
 * Server-rendered pages are deliberately not cached: an old copy of the approval queue served as if
 * it were current is a lie. Public legal pages are prerendered and precached separately.
 *
 * **Deploys do not break open pages**. A new worker installs and then waits: no automatic
 * `skipWaiting()`. The previous build's cache is kept one generation longer, and assets are looked
 * up across both, so a page still running the old build keeps finding its lazy chunks.
 */

import { assets, immutable, prerendered } from "$app/manifest";
import { version } from "$app/env";
import { self } from "$app/service-worker";
import { isMirroredPath } from "#lib/offline/tiers.js";
import { isOurs } from "#lib/offline/guard.js";
import { ASSET_BUDGET_MS, reach, send, sleep, withBudget } from "./shared.js";

const CACHE = `pidra-${version}`;
const SHELL_CACHE = `pidra-shell-${version}`;
const SHELL_KEY = "/__pidra/shell";
/** Which builds' caches exist, oldest first. Kept in its own cache, which no version owns. */
const META_CACHE = "pidra-meta";
const GENERATIONS_KEY = "/__pidra/generations";
/** This build and the one before it. */
const GENERATIONS_KEPT = 2;
/** Any mirrored route serves the shell; this one runs no load on the server at all. */
const SHELL_SOURCE = "/notes";
const STATIC_DOCUMENTS = new Set(["/privacy", "/terms"]);

const NAV_BUDGET_MS = 3_000;
/** Parallel precache requests, so an install does not saturate the same link the app uses. */
const PRECACHE_CONCURRENCY = 3;
/** On a device's first install the page is loading right now; its own requests go first. */
const FIRST_INSTALL_DELAY_MS = 1_500;

const PRECACHE = [
  ...immutable.map((file) => file.path),
  ...assets.map((file) => file.path),
  ...prerendered.map((page) => page.path),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // The shell of this build first, fetched now while the network is known to be there (the
    // worker script itself just came over it). Without this, the first launch after a deploy that
    // happens offline would have no document for this version at all, although the mirror is full.
    fromNetwork(new Request(SHELL_SOURCE))
      .catch(() => {})
      .then(() => (self.registration.active ? undefined : sleep(FIRST_INSTALL_DELAY_MS)))
      .then(precache),
    // No `skipWaiting()`: see the header. The very first install on a device has no page to break
    // and activates at once anyway.
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    rememberGeneration()
      .then((kept) => {
        const keep = new Set([META_CACHE, ...kept.flatMap((v) => [`pidra-${v}`, `pidra-shell-${v}`])]);
        return caches.keys().then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))));
      })
      .then(() => self.clients.claim()),
  );
});

/**
 * Every build file, a few at a time. A hashed `/_app/immutable/` file the previous build already
 * cached is the same bytes, so it is copied across instead of downloaded: a deploy fetches only
 * what it changed. One missing asset must not fail the whole install, which would leave the worker
 * stuck on the previous version forever.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  const queue = [...PRECACHE];
  const next = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        const known = path.startsWith("/_app/immutable/") ? await caches.match(path) : undefined;
        if (known) await cache.put(path, known);
        else {
          const response = await send(new Request(path), ASSET_BUDGET_MS);
          if (!response.ok) throw new Error(`${path}: ${response.status}`);
          await cache.put(path, response);
        }
      } catch {
        // Fetched on first use instead, by `cacheFirst`.
      }
    }
  };
  await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, next));
}

/** Records this build as the newest generation and answers the versions whose caches stay. */
async function rememberGeneration(): Promise<string[]> {
  const meta = await caches.open(META_CACHE);
  const stored = await meta.match(GENERATIONS_KEY);
  const previous = stored ? ((await stored.json().catch(() => [])) as string[]) : [];
  const kept = [...previous.filter((v) => v !== version), version].slice(-GENERATIONS_KEPT);
  await meta.put(GENERATIONS_KEY, Response.json(kept));
  return kept;
}

/** Shown only when the device has never cached a shell: first launch, with no connection. */
function offlineDocument(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#111214"><title>PIDRA</title>
<style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#111214;color:#d4d6db;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:16px}h1{color:#f0f2f5;font-size:18px;margin:0 0 8px}p{margin:0 0 16px;color:#b8bac0}button{font:inherit;padding:10px 20px;border-radius:8px;border:1px solid #24467f;background:#1e3a6e;color:#f0f2f5}</style></head>
<body><main><h1>PIDRA is offline</h1><p>Nothing is stored on this device yet. Open the app once with a connection and it will work offline from then on.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function cachedShell(): Promise<Response | undefined> {
  return caches.open(SHELL_CACHE).then((cache) => cache.match(SHELL_KEY));
}

async function fallbackDocument(): Promise<Response> {
  return (await cachedShell()) ?? offlineDocument();
}

/**
 * Same redirect the auth gate itself would have sent, reconstructed rather than read: an
 * opaque-redirect response carries no readable Location (the whole point of "opaque"), but a
 * mirrored path's server only ever answers with a redirect for this one reason. `navigate()` is a
 * real top-level navigation, so it re-enters `hooks.server.ts` and gets the live answer, cookie and
 * all - this is a best-effort push, not the source of truth.
 */
async function forceReauth(pathname: string): Promise<void> {
  const target = `/login?redirect=${encodeURIComponent(pathname)}`;
  const windows = await self.clients.matchAll({ type: "window" });
  await Promise.all(windows.map((client) => ("navigate" in client ? (client as WindowClient).navigate(target).catch(() => {}) : undefined)));
}

async function navigation(event: FetchEvent): Promise<Response> {
  const { pathname } = new URL(event.request.url);

  if (isMirroredPath(pathname)) {
    const shell = await cachedShell();
    if (shell) {
      // Refreshed behind the page, bounded like everything else, so a blackhole cannot keep the
      // worker alive until the OS gives up. A late or missing answer says nothing the page's own
      // requests will not say sooner - except a session that expired since the shell was cached: the
      // mirror answers from IndexedDB with no auth check of its own (by design, so a genuinely
      // offline device keeps reading it), so the tab would otherwise sit on stale, possibly private
      // report content until some unrelated request happened to surface a 401. An opaque redirect
      // here is that gate firing, and the open tab is sent to `/login` directly instead of waiting.
      event.waitUntil(
        fromNetwork(event.request)
          .then((response) => {
            if (response.type === "opaqueredirect") return forceReauth(pathname);
          })
          .catch(() => {
            reach.offline = true;
          }),
      );
      return shell;
    }
  }

  if (reach.offline) {
    // Still ask, in the background: a late answer refreshes the shell and clears the flag, so the
    // next navigation goes to the network again without the page having to say so.
    event.waitUntil(fromNetwork(event.request).catch(() => {}));
    return fallbackDocument();
  }

  const network = fromNetwork(event.request);
  // A navigation that outruns the page's budget keeps going up to its own (`send`); when it lands
  // inside that, it still refreshes the shell.
  event.waitUntil(network.catch(() => {}));
  return withBudget(network, NAV_BUDGET_MS).catch(() => {
    reach.offline = true;
    return fallbackDocument();
  });
}

async function fromNetwork(request: Request): Promise<Response> {
  const response = await send(request, ASSET_BUDGET_MS);
  // A manual-redirect navigation (the auth gate sending `/` to `/login`) comes back opaque by
  // spec: no headers, so the stamp cannot be read. It is still `hooks.server.ts` answering - the
  // request never left `self.location.origin` - and it must go straight back to the browser,
  // which alone can turn it into a real navigation to the redirect target. Treating it as "someone
  // else answered" was falling back to the no-shell-yet offline page on every logged-out visit.
  if (response.type === "opaqueredirect") {
    reach.offline = false;
    return response;
  }
  if (!isOurs(response)) throw new Error("answered by something other than the app");
  reach.offline = false;
  if (response.ok && response.headers.has("x-pidra-shell")) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_KEY, response.clone());
  }
  return response;
}

async function cacheFirst(request: Request): Promise<Response> {
  // Across every cache, not only this build's: a page still running the previous build asks for
  // that build's chunks, which only its generation's cache holds.
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const response = await send(request, ASSET_BUDGET_MS);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The repository layer (`repo.ts`) decides what stale API data is acceptable, in one
  // place that can reason about it, and `net.ts` bounds every such request. A worker that
  // silently answers an API call from cache is exactly how a stale rating or a vanished note
  // appears as a bug with no explanation.
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith("/__data.json")) return;

  if (url.pathname.startsWith("/_app/immutable/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    if (STATIC_DOCUMENTS.has(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }
    event.respondWith(navigation(event));
  }
});
