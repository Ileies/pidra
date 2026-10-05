/**
 * The service worker's entry (SvelteKit requires it at this path). The logic is in `./sw/`:
 * `cache.ts` (precache, shell, bounded navigations), `sync.ts` (outbox drain + snapshot pull),
 * `push.ts` (morning push); `shared.ts` holds the reachability flag and bounded fetch. This file
 * only handles page messages: `pidra:reachability` (page -> worker), `pidra:reachability?`
 * (reply on the MessagePort), `pidra:skip-waiting` (see `lib/offline/update.svelte.ts`).
 *
 * The precache list comes from `$app/manifest`, `version` from `$app/env` (`$service-worker` no
 * longer exists in this SvelteKit version); `self` from `$app/service-worker` is typed as
 * `ServiceWorkerGlobalScope`.
 *
 * Must stay free of `$app/navigation` and anything needing a `window` (separate global scope;
 * scripts/check-offline.ts exempts `sw/` from the bare-fetch rule). A response without the
 * `x-pidra` stamp is treated as no answer. Overview: docs/offline-mode.md.
 */
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { self } from "$app/service-worker";
import { reach } from "./sw/shared.js";
import "./sw/cache.js";
import "./sw/sync.js";
import "./sw/push.js";

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; state?: string } | null;
  if (data?.type === "pidra:reachability") {
    reach.offline = data.state === "offline";
  } else if (data?.type === "pidra:reachability?") {
    event.ports[0]?.postMessage({ state: reach.offline ? "offline" : "unknown" });
  } else if (data?.type === "pidra:skip-waiting") {
    // The reader tapped Reload; the page reloads itself on `controllerchange`.
    void self.skipWaiting();
  }
});
