/**
 * Web Push subscription state for this device, held globally.
 *
 * Started once from the root layout so the browser's answer (service worker ready, current
 * subscription) is already in by the time Settings opens. Keeping it in the component instead
 * meant every visit to `/settings` began in "checking" and the switch animated from off to on.
 */

import { jsonInit } from "#lib/http.js";
import { errMessage } from "$pipeline/util/text";
import { PUBLIC_VAPID_KEY } from "$app/env/public";
import { toasts } from "#lib/toast.svelte.js";
import { net } from "#lib/offline/net.js";

type PushState = "checking" | "unsupported" | "denied" | "unsubscribed" | "subscribed" | "busy";

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

class PushStore {
  state = $state<PushState>("checking");

  #started = false;

  async start(): Promise<void> {
    if (this.#started || typeof window === "undefined") return;
    this.#started = true;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      this.state = "unsupported";
      return;
    }
    if (Notification.permission === "denied") {
      this.state = "denied";
      return;
    }
    const sw = await navigator.serviceWorker.ready;
    this.state = (await sw.pushManager.getSubscription()) ? "subscribed" : "unsubscribed";
  }

  async toggle(): Promise<void> {
    this.state = "busy";
    try {
      const sw = await navigator.serviceWorker.ready;
      const existing = await sw.pushManager.getSubscription();

      if (existing) {
        await net("/api/push/subscribe", jsonInit("DELETE", { endpoint: existing.endpoint }));
        await existing.unsubscribe();
        this.state = "unsubscribed";
        toasts.show("Notifications off.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        this.state = "denied";
        return;
      }

      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
      });

      await net("/api/push/subscribe", jsonInit("POST", sub.toJSON()));

      this.state = "subscribed";
      toasts.success("Notifications on.");
    } catch (err) {
      console.error("[push]", err);
      this.state = "unsubscribed";
      toasts.error(errMessage(err));
    }
  }
}

export const push = new PushStore();
