/**
 * Service worker: push, and enough caching that yesterday's briefing is readable off the LAN.
 *
 * Before this it handled push and nothing else, which made the PWA an app that only worked at
 * home - most of the point of installing it on a phone is that the 06:45 read survives a train
 * (M-8, and it is what makes the push deep-link in E5 land on something).
 *
 * Strategy:
 *   - immutable build assets, fonts, icons: cache-first, they are content-hashed or static.
 *   - report pages (`/YYYY-MM-DD`): network-first, cached on success, newest seven kept. A
 *     stale briefing shown while the network is fine would be worse than a slow one.
 *   - everything else, including /api: straight to the network. Notes, skills and the chat are
 *     live state and a cached copy of them would be a lie.
 */

const VERSION = "v1";
const SHELL_CACHE = `pidra-shell-${VERSION}`;
const REPORT_CACHE = `pidra-reports-${VERSION}`;
const MAX_REPORTS = 7;

const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/inter-latin-wght-normal.woff2",
  "/fonts/jetbrains-mono-latin-wght-normal.woff2",
];

const REPORT_PATH = /^\/\d{4}-\d{2}-\d{2}$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A single missing asset must not fail the whole install, which would leave the worker
      // stuck on the previous version forever.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== REPORT_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Keeps the report cache to the newest MAX_REPORTS entries, by date in the path. */
async function trimReports(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_REPORTS) return;
  const sorted = keys.sort((a, b) => new URL(b.url).pathname.localeCompare(new URL(a.url).pathname));
  await Promise.all(sorted.slice(MAX_REPORTS).map((request) => cache.delete(request)));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function reportNetworkFirst(request) {
  const cache = await caches.open(REPORT_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await trimReports(cache);
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_app/immutable/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (request.mode === "navigate" && REPORT_PATH.test(url.pathname)) {
    event.respondWith(reportNetworkFirst(request));
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
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = self.location.origin + target;
      for (const client of list) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
