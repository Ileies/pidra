/**
 * Worker caching: precache, the shell, bounded navigations. Caches: `pidra-<version>` (assets),
 * `pidra-shell-<version>` (one document), `pidra-meta` (generation list). Tiers: lib/offline/tiers.ts.
 *
 * - Shell, cache-first: mirrored routes are `ssr = false`, so the server returns one
 *   route-agnostic HTML document (marked `x-pidra-shell` in `hooks.server.ts`). A navigation to a
 *   mirrored path gets the cached shell at once, online or not; the network only refreshes it.
 * - Everything else is bounded: offline is usually a blackhole, so a live page's navigation races
 *   `NAV_BUDGET_MS` and then boots the shell (its load fails into `OfflineNotice`). Server-rendered
 *   pages are deliberately never cached (a stale approval queue would read as current).
 * - `/api/**` and `__data.json` are not handled here: `lib/offline/net.ts` bounds them in the page.
 * - Deploys must not break open pages: no automatic `skipWaiting()`; the previous build's cache
 *   is kept one extra generation and assets are looked up across both.
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
    // This build's shell first, while the network is known to be up: otherwise a first launch
    // after a deploy that happens offline has no document for this version despite a full mirror.
    fromNetwork(new Request(SHELL_SOURCE))
      .catch(() => {})
      .then(() => (self.registration.active ? undefined : sleep(FIRST_INSTALL_DELAY_MS)))
      .then(precache),
    // No `skipWaiting()` (see header); the very first install activates at once anyway.
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
 * Every build file, a few at a time. Hashed `/_app/immutable/` files already cached by the previous
 * build are copied, not downloaded. One missing asset must not fail the install (the worker would
 * stay stuck on the previous version), so errors are swallowed and `cacheFirst` fetches on demand.
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
 * Sends open tabs to `/login`. The redirect target is reconstructed because an opaque redirect has
 * no readable Location; a mirrored path only redirects for the auth gate. `navigate()` re-enters
 * `hooks.server.ts`, so this is a best-effort push, not the source of truth.
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
      // Refreshed behind the page, bounded. The mirror reads IndexedDB with no auth check (by
      // design, for offline), so an expired session would otherwise keep showing private report
      // content until some request hit a 401. An opaque redirect here is the auth gate firing:
      // send the tab to `/login` directly.
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
    // Still ask in the background: a late answer clears the flag for the next navigation.
    event.waitUntil(fromNetwork(event.request).catch(() => {}));
    return fallbackDocument();
  }

  const network = fromNetwork(event.request);
  // After `NAV_BUDGET_MS` the page boots the shell, but this request continues to its `send`
  // budget and still refreshes the shell if it lands.
  event.waitUntil(network.catch(() => {}));
  return withBudget(network, NAV_BUDGET_MS).catch(() => {
    reach.offline = true;
    return fallbackDocument();
  });
}

async function fromNetwork(request: Request): Promise<Response> {
  const response = await send(request, ASSET_BUDGET_MS);
  // A manual-redirect navigation (auth gate sending `/` to `/login`) is opaque: no headers, so the
  // stamp is unreadable. It is still the app answering and must go straight back to the browser;
  // treating it as foreign showed the offline page on every logged-out visit.
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

  // Never answer API data from cache: `repo.ts` owns staleness, `net.ts` bounds the request.
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
