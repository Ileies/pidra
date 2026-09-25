/**
 * Deploys stop breaking open pages (OFFLINE_PLAN.md §14.3, H2). The worker used to `skipWaiting()`
 * on install and delete the old build's cache on activate, which pulled the chunks out from under a
 * page still running the previous build: its next lazy route chunk missed the cache and 404'd
 * online or hung offline. Now a new worker installs and waits, this says so, and it takes over on
 * the reader's tap (then the page reloads into the new build) or on the next cold start, when no
 * page of the old build is left to break.
 */

import { browser } from "$app/env";
import { reachability } from "./net.js";

/** How often a foregrounded app asks whether a new worker exists. The browser's own check only
 *  runs on full navigations, which an installed single-page app rarely makes. */
const CHECK_EVERY_MS = 30 * 60_000;

class AppUpdate {
  ready = $state(false);

  #registration: ServiceWorkerRegistration | null = null;
  #lastCheck = 0;
  #started = false;

  start(): void {
    if (this.#started || !browser || !("serviceWorker" in navigator)) return;
    this.#started = true;

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
