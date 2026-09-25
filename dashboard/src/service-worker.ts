/**
 * Precache, the shell, bounded navigations, and push. Replaces `static/sw.js`.
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
 * **The shell, cache-first** (OFFLINE_PLAN.md §14.3, H2). Mirrored routes are `ssr = false`, so the
 * HTML the server returns for any of them is the same route-agnostic document; `hooks.server.ts`
 * marks it with `x-pidra-shell`. A navigation to a mirrored path is answered from the cached shell
 * straight away, online or not, and the network only refreshes it in the background: SvelteKit
 * boots from it and routes by `location` (render.js only emits a hydrate payload when SSR is on),
 * and the page reads the mirror. That takes the network out of every launch. Only a device with no
 * shell yet goes to the network first.
 *
 * **Everything else is bounded** (§14). Offline is usually a blackhole, not an error: with the VPN
 * app up and no network beneath it, a request neither succeeds nor fails, it waits for the OS
 * connect timeout. So a live page's navigation races the network against `NAV_BUDGET_MS` and then
 * boots the cached shell (its load then fails into `OfflineNotice`), and an asset missing from the
 * precache gets `ASSET_BUDGET_MS`. Every request the worker makes is *aborted* at its budget
 * (`send`), not just stopped being waited for. `/api/**` and `__data.json` are not touched here:
 * `$lib/offline/net.ts` bounds those in the page, where the answer can be turned into a designed
 * state. Server-rendered pages are deliberately not cached: an old copy of the approval queue
 * served as if it were current is the lie OFFLINE_PLAN.md §1 rules out. Public legal pages are
 * prerendered and precached separately, so their full text opens offline.
 *
 * **Deploys do not break open pages** (H2). A new worker installs and then waits: no automatic
 * `skipWaiting()`. The app says a new version is ready and hands over on a tap
 * (`$lib/offline/update.svelte.ts`), or the new worker takes over on the next cold start. The
 * previous build's cache is kept one generation longer, and assets are looked up across both, so a
 * page still running the old build keeps finding its lazy chunks.
 *
 * **A response the app did not write is not the app.** `hooks.server.ts` stamps `x-pidra` on every
 * response; one without it (nginx's 403 from the public path when DNS answers the public address,
 * a captive portal) is treated like no answer at all instead of being shown as the document.
 *
 * **The worker syncs, too** (H3). The 06:30 push pulls the snapshot while the notification is
 * shown, so the morning briefing is in the mirror before it is tapped, including on a phone that
 * then goes on a train without the VPN. Queued writes flush from here on Background Sync
 * (`pidra-outbox`, registered by `outbox.ts` when a write could not go out) and on the push, and a
 * periodic sync refreshes the mirror where the browser grants one. All of it is the same code the
 * pages run (`intents.ts`, `snapshot.ts`), under the same Web Locks, with this worker's own bounded
 * transport; an open page is told which stores changed and re-renders them.
 */
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { assets, immutable, prerendered } from "$app/manifest";
import { version } from "$app/env";
import { self } from "$app/service-worker";
import { isMirroredPath } from "#lib/routes.js";
import { drain } from "#lib/offline/intents.js";
import { pullSnapshot } from "#lib/offline/snapshot.js";
import type { MirrorStore } from "#lib/offline/db.js";

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
const ASSET_BUDGET_MS = 10_000;
/**
 * Each request the worker's own sync makes. A push gives the worker little time (iOS is the tight
 * one), and a blackhole would otherwise hold it until the OS gives up; the full snapshot is 178 kB
 * compressed, well inside this over a working link.
 */
const SYNC_BUDGET_MS = 20_000;
/** Parallel precache requests, so an install does not saturate the same VPN link the app uses. */
const PRECACHE_CONCURRENCY = 3;
/** On a device's first install the page is loading right now; its own requests go first. */
const FIRST_INSTALL_DELAY_MS = 1_500;

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

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; state?: string } | null;
  if (data?.type === "pidra:reachability") {
    offline = data.state === "offline";
  } else if (data?.type === "pidra:reachability?") {
    event.ports[0]?.postMessage({ state: offline ? "offline" : "unknown" });
  } else if (data?.type === "pidra:skip-waiting") {
    // The reader tapped Reload; the page reloads itself on `controllerchange`.
    void self.skipWaiting();
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A request this worker makes, aborted when its budget runs out (found by the H5 blackhole suite).
 * `withBudget()` alone only stops *waiting*: the request itself kept its socket until the OS gave
 * up, 11 to 24 s in the suite, and over HTTP/1.1 a handful of those take the whole per-host
 * connection pool, so the page's own probe queued behind them and the app could not even tell it
 * was back online. The timer is never cleared: the abort also covers a body that stalls after the
 * headers, and aborting a request that already finished does nothing.
 */
function send(request: Request, ms: number): Promise<Response> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  // A navigation request cannot be passed to `fetch` together with an init, so it is rebuilt from
  // its parts; `redirect: "manual"` is what a navigation has, and what it must get back.
  if (request.mode === "navigate") {
    return fetch(request.url, { headers: request.headers, credentials: request.credentials, redirect: "manual", signal: controller.signal });
  }
  return fetch(request, { signal: controller.signal });
}

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
<body><main><h1>PIDRA is offline</h1><p>Nothing is stored on this device yet. Open the app once with the VPN on and it will work offline from then on.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function cachedShell(): Promise<Response | undefined> {
  return caches.open(SHELL_CACHE).then((cache) => cache.match(SHELL_KEY));
}

async function fallbackDocument(): Promise<Response> {
  return (await cachedShell()) ?? offlineDocument();
}

async function navigation(event: FetchEvent): Promise<Response> {
  const { pathname } = new URL(event.request.url);

  if (isMirroredPath(pathname)) {
    const shell = await cachedShell();
    if (shell) {
      // Refreshed behind the page, bounded like everything else, so a blackhole cannot keep the
      // worker alive until the OS gives up. A late or missing answer says nothing the page's own
      // requests will not say sooner.
      event.waitUntil(
        fromNetwork(event.request).catch(() => {
          offline = true;
        }),
      );
      return shell;
    }
  }

  if (offline) {
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
    offline = true;
    return fallbackDocument();
  });
}

async function fromNetwork(request: Request): Promise<Response> {
  const response = await send(request, ASSET_BUDGET_MS);
  if (!response.headers.has("x-pidra")) throw new Error("answered by something other than the app");
  offline = false;
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

// --- the worker's own sync (H3) ---

/**
 * The worker's transport for `drain` and `pullSnapshot`: bounded, and a response without the
 * `x-pidra` stamp is someone else's, exactly as `net.ts` decides it in a page.
 */
class NotSent extends Error {}

async function syncFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!self.navigator.onLine) throw new NotSent("offline");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_BUDGET_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.headers.has("x-pidra")) throw new Error("answered by something other than the app");
    // Read inside the budget, so a body that stalls after the headers cannot hold the worker.
    const body = await response.arrayBuffer();
    offline = false;
    const nullBody = response.status === 204 || response.status === 205 || response.status === 304;
    return new Response(nullBody ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (err) {
    offline = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Tells every open page which stores changed, so it re-renders them (`state.svelte.ts`). A pull
 *  that changed nothing is still said: it moved `lastSyncedAt`, which the page shows. */
async function announce(stores: MirrorStore[], outbox: boolean, pulled: boolean): Promise<void> {
  if (stores.length === 0 && !outbox && !pulled) return;
  const windows = await self.clients.matchAll({ type: "window" });
  for (const client of windows) client.postMessage({ type: "pidra:mirror-changed", stores, outbox });
}

interface WorkerSyncResult {
  /** False when a queued write is still waiting on the network. */
  flushed: boolean;
  pulled: boolean;
}

let syncing: Promise<WorkerSyncResult> | null = null;

/**
 * Drain the outbox, then pull the snapshot, like `sync.ts` in a page. `pull: "if-flushed"` only
 * pulls when a write actually went out, which is all a Background Sync for the queue needs; the
 * page does its own pull when it is open.
 */
function workerSync(pull: "always" | "if-flushed"): Promise<WorkerSyncResult> {
  syncing ??= (async () => {
    const drained = await drain(syncFetch, { notSent: (err) => err instanceof NotSent }).catch(() => ({
      complete: false,
      delivered: 0,
      changed: [] as MirrorStore[],
    }));
    let pulled = false;
    let changed = drained.changed;
    if (pull === "always" || drained.delivered > 0) {
      try {
        const result = await pullSnapshot(syncFetch);
        changed = [...new Set([...changed, ...result.changed])];
        pulled = true;
      } catch {
        // Offline or failed; the page's own sync tries again when it opens.
      }
    }
    await announce(changed, drained.delivered > 0, pulled);
    return { flushed: drained.complete, pulled };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Background Sync and Periodic Background Sync, which lib.webworker does not type. */
interface TaggedSyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener("sync", (event) => {
  const sync = event as TaggedSyncEvent;
  if (sync.tag !== "pidra-outbox") return;
  // Rejecting tells the browser the queue is not empty yet, and it retries with its own backoff.
  sync.waitUntil(
    workerSync("if-flushed").then((result) => {
      if (!result.flushed) throw new Error("outbox still queued");
    }),
  );
});

self.addEventListener("periodicsync", (event) => {
  const sync = event as TaggedSyncEvent;
  if (sync.tag === "pidra-mirror") sync.waitUntil(workerSync("always"));
});

const NOTIFICATION_ICON = "/icons/icon-192.png";

/**
 * The notification icon as a `data:` URL read from the precache. Given a path, the browser fetches
 * the icon from the origin before it shows anything, outside this worker and without its budgets,
 * so with the VPN off and the icon not in the HTTP cache a push showed nothing for over 40 s in
 * testing (2026-09-25) - the 06:30 briefing on a train, exactly. Without a cached copy the icon is
 * left out rather than risk that wait; the browser's default is shown instead.
 */
async function cachedIcon(): Promise<string | undefined> {
  try {
    const hit = await caches.match(NOTIFICATION_ICON);
    if (!hit) return undefined;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${hit.headers.get("content-type") ?? "image/png"};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  // The pull runs beside the notification, never before it: a push that shows nothing for long is
  // one iOS counts against the subscription. `waitUntil` keeps the worker alive for both.
  event.waitUntil(workerSync("always").catch(() => {}));
  event.waitUntil(
    cachedIcon().then((icon) =>
      self.registration.showNotification(data.title ?? "PIDRA", {
        body: data.body ?? "Today's briefing is ready.",
        icon,
        badge: icon,
        tag: data.date ? `report-${data.date}` : "pidra",
        data: { url: data.url ?? "/" },
        actions: data.date
          ? [
              { action: "personal", title: "Personal first" },
              { action: "open", title: "Open report" },
            ]
          : [],
      }),
    ),
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
