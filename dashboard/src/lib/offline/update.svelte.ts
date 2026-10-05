/**
 * Surfaces a waiting service worker (`ready`) and applies it on the reader's tap. The worker must
 * not `skipWaiting()` on its own: replacing the cache under a page of the previous build 404s or
 * hangs its next lazy chunk. It takes over on `apply()` (page reloads) or on the next cold start.
 * Message contract with `service-worker.ts`: `pidra:skip-waiting`.
 */

import { reachability } from "./net.js";

/** How often a foregrounded app asks whether a new worker exists. The browser's own check only
 *  runs on full navigations, which an installed single-page app rarely makes. */
const CHECK_EVERY_MS = 30 * 60_000;

class AppUpdate {
  ready = $state(false);

  #registration: ServiceWorkerRegistration | null = null;
  #lastCheck = 0;

  start(): void {
    if (!("serviceWorker" in navigator)) return;

    // `ready` resolves once there is an active worker, whenever app.html's registration lands.
    void navigator.serviceWorker.ready.then((registration) => {
      this.#registration = registration;
      this.#track(registration);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !this.#registration || reachability() !== "online") return;
      if (Date.now() - this.#lastCheck < CHECK_EVERY_MS) return;
      this.#lastCheck = Date.now();
      this.#registration.update().catch(() => {});
    });
  }

  #track(registration: ServiceWorkerRegistration): void {
    // Only an update when something already controls this page; the very first install on a
    // device activates straight away and there is nothing to reload into.
    const check = () => {
      this.ready = !!registration.waiting && !!navigator.serviceWorker.controller;
    };
    check();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", check);
    });
  }

  /** Hands over to the waiting worker and reloads once it controls the page. */
  apply(): void {
    const waiting = this.#registration?.waiting;
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    waiting.postMessage({ type: "pidra:skip-waiting" });
  }
}

export const appUpdate = new AppUpdate();
