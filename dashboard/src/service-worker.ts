/**
 * Precache, a bounded navigation with a shell fallback, and push. Replaces `static/sw.js`.
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
 * **Nothing here waits on the network without a budget** (OFFLINE_PLAN.md §14). Offline is usually
 * a blackhole, not an error: with the VPN app up and no network beneath it, a request neither
 * succeeds nor fails, it waits for the OS connect timeout. So a navigation races the network
 * against `NAV_BUDGET_MS` and then boots the cached shell, and an asset missing from the precache
 * gets `ASSET_BUDGET_MS`. `/api/**` and `__data.json` are not touched here: `$lib/offline/net.ts`
 * bounds those in the page, where the answer can be turned into a designed state.
 *
 * **The shell.** Mirrored routes are `ssr = false`, so the HTML the server returns for any of them
 * is the same route-agnostic document; `hooks.server.ts` marks it with `x-pidra-shell`. The newest
 * one is kept under `SHELL_KEY` and serves every navigation the network cannot answer, whatever
 * the path: SvelteKit boots from it and routes by `location` (render.js only emits a hydrate
 * payload when SSR is on). A live page that is not mirrored boots too, and its load then fails
 * into `OfflineNotice`. Server-rendered pages are deliberately not cached: an old copy of the
 * approval queue served as if it were current is the lie OFFLINE_PLAN.md §1 rules out. Public
 * legal pages are prerendered and precached separately, so their full text opens offline.
 *
 * **A response the app did not write is not the app.** `hooks.server.ts` stamps `x-pidra` on every
 * response; one without it (nginx's 403 from the public path when DNS answers the public address,
 * a captive portal) is treated like no answer at all instead of being shown as the document.
 */
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { assets, immutable, prerendered } from "$app/manifest";
import { version } from "$app/env";
import { self } from "$app/service-worker";

const CACHE = `pidra-${version}`;
const SHELL_CACHE = `pidra-shell-${version}`;
const SHELL_KEY = "/__pidra/shell";
/** Any mirrored route serves the shell; this one runs no load on the server at all. */
const SHELL_SOURCE = "/notes";
const STATIC_DOCUMENTS = new Set(["/privacy", "/terms"]);

const NAV_BUDGET_MS = 3_000;
const ASSET_BUDGET_MS = 10_000;

const PRECACHE = [
  ...immutable.map((file) => file.path),
  ...assets.map((file) => file.path),
  ...prerendered.map((page) => page.path),
];

/**
 * What the worker believes about reachability. Sticky on purpose: it is set by a navigation that
 * got no answer and cleared by one that did, or by the page (`net.ts` posts every change), so a
 * page that boots from the shell can ask for it and go straight to the mirror.
 */
let offline = false;

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.allSettled([
      caches
        .open(CACHE)
        // One missing asset must not fail the whole install, which would leave the worker stuck
        // on the previous version forever.
        .then((cache) => Promise.allSettled(PRECACHE.map((path) => cache.add(path)))),
      // The shell of this build, fetched now while the network is known to be there (the worker
      // script itself just came over it). Without this, the first launch after a deploy that
      // happens offline would have no document for this version at all, although the mirror is full.
      withBudget(fromNetwork(new Request(SHELL_SOURCE)), ASSET_BUDGET_MS),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; state?: string } | null;
  if (data?.type === "pidra:reachability") {
    offline = data.state === "offline";
  } else if (data?.type === "pidra:reachability?") {
    event.ports[0]?.postMessage({ state: offline ? "offline" : "unknown" });
  }
});

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("budget exceeded")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Shown only when the device has never cached a shell: first launch, with no connection. */
function offlineDocument(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#111214"><title>PIDRA</title>
<style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#111214;color:#d4d6db;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:16px}h1{color:#f0f2f5;font-size:18px;margin:0 0 8px}p{margin:0 0 16px;color:#b8bac0}button{font:inherit;padding:10px 20px;border-radius:8px;border:1px solid #24467f;background:#1e3a6e;color:#f0f2f5}</style></head>
<body><main><h1>PIDRA is offline</h1><p>Nothing is stored on this device yet. Open the app once with the VPN on and it will work offline from then on.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function fallbackDocument(): Promise<Response> {
  const shell = await caches.open(SHELL_CACHE).then((cache) => cache.match(SHELL_KEY));
  return shell ?? offlineDocument();
}

function navigation(event: FetchEvent): Promise<Response> {
  if (offline) {
    // Still ask, in the background: a late answer refreshes the shell and clears the flag, so the
    // next navigation goes to the network again without the page having to say so.
    event.waitUntil(fromNetwork(event.request).catch(() => {}));
    return fallbackDocument();
  }

  const network = fromNetwork(event.request);
  // A navigation that outruns the budget keeps going; when it lands, it still refreshes the shell.
  event.waitUntil(network.catch(() => {}));
  return withBudget(network, NAV_BUDGET_MS).catch(() => {
    offline = true;
    return fallbackDocument();
  });
}

async function fromNetwork(request: Request): Promise<Response> {
  const response = await fetch(request);
  if (!response.headers.has("x-pidra")) throw new Error("answered by something other than the app");
  offline = false;
  if (response.ok && response.headers.has("x-pidra-shell")) {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_KEY, response.clone());
  }
  return response;
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await withBudget(fetch(request), ASSET_BUDGET_MS);
    if (response.ok) cache.put(request, response.clone());
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

  // The repository layer (OFFLINE_PLAN.md §3) decides what stale API data is acceptable, in one
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
