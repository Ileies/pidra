/**
 * Precache, a navigation fallback and push. Replaces `static/sw.js`.
 *
 * The old worker's precache list (`SHELL_ASSETS`) was hand-written and named no build output at
 * all - everything under `/_app/immutable/` was cached opportunistically, only after being
 * fetched once. So a cold offline start right after any deploy had no JS and showed nothing.
 * Building this from `$app/manifest` fixes that: every build asset, static file and prerendered
 * page is precached on install, keyed by the build version.
 *
 * `$service-worker` was removed in this SvelteKit version (see
 * node_modules/@sveltejs/kit/src/exports/vite/index.js:91): `immutable` / `assets` / `prerendered`
 * now come from `$app/manifest`, `version` from `$app/env`. The `self` import below is typed as
 * `ServiceWorkerGlobalScope` (`$app/service-worker`'s one remaining export) so this file type-checks
 * under the project's single, DOM-oriented tsconfig without a separate worker tsconfig.
 *
 * Navigations are still cached one-per-path, network-first - this is not yet the route-agnostic
 * shell described in OFFLINE_PLAN.md §7 (a single cached document that can boot any Tier A path).
 * That needs Tier A pages on `ssr = false`, which is O2. Until then, a route visited once while
 * online is available offline; one never visited still shows the browser's own offline page.
 */
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { assets, immutable, prerendered } from "$app/manifest";
import { version } from "$app/env";
import { self } from "$app/service-worker";

const CACHE = `pidra-${version}`;
const NAV_CACHE = `pidra-nav-${version}`;
const MAX_NAV_ENTRIES = 30;

const PRECACHE = [
  ...immutable.map((file) => file.path),
  ...assets.map((file) => file.path),
  ...prerendered.map((page) => page.path),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing asset must not fail the whole install, which would leave the worker stuck
      // on the previous version forever.
      .then((cache) => Promise.allSettled(PRECACHE.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== NAV_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** No real recency on a Cache key, so oldest-inserted (`cache.keys()` order) stands in for LRU.
 *  Good enough for a personal-use archive of HTML documents. */
async function trimNavCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  if (keys.length <= MAX_NAV_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_NAV_ENTRIES).map((request) => cache.delete(request)));
}

async function networkFirstNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(NAV_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimNavCache(cache);
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The repository layer (OFFLINE_PLAN.md §3, landing in O2) decides what stale API data is
  // acceptable, in one place that can reason about it. A worker that silently answers an API call
  // from cache is exactly how a stale rating or a vanished note appears as a bug with no explanation.
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_app/immutable/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "PIDRA", {
      body: data.body ?? "Today's briefing is ready.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.date ? `report-${data.date}` : "pidra",
      data: { url: data.url ?? "/" },
      actions: data.date
        ? [
            { action: "personal", title: "Personal first" },
            { action: "open", title: "Open report" },
          ]
        : [],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = event.notification.data?.url ?? "/";
  // The Personal Action Center leads the report, so its anchor is where an action jumps to.
  const target = event.action === "personal" ? `${base}#personal` : base;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = self.location.origin + target;
      for (const client of list) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
