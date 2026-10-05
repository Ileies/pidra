/**
 * The service worker's entry: precache, the shell, bounded navigations and push, in `./sw/`
 * (`cache.ts`, `sync.ts`, `push.ts`). Replaces `static/sw.js`. SvelteKit wants the worker at this
 * path and bundles whatever it imports, so the split costs nothing at runtime.
 *
 * The precache list comes from `$app/manifest` (every build asset, static file and prerendered
 * page, keyed by the build version), because a hand-written list named no build output at all and
 * a cold offline start right after a deploy had no JS. `$service-worker` was removed in this
 * SvelteKit version (see node_modules/@sveltejs/kit/src/exports/vite/index.js:91): `immutable` /
 * `assets` / `prerendered` come from `$app/manifest`, `version` from `$app/env`, and `self` from
 * `$app/service-worker` is typed as `ServiceWorkerGlobalScope`.
 *
 * **A response the app did not write is not the app.** `hooks.server.ts` stamps `x-pidra` on every
 * response; one without it (nginx's 403 from the public path when DNS answers the public address,
 * a captive portal) is treated like no answer at all instead of being shown as the document.
 *
 * Free of `$app/navigation` and of anything that needs a `window`: the worker is a separate global
 * scope (`scripts/check-offline.ts` exempts `sw/` from the bare-fetch rule for that reason).
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
