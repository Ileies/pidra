<script lang="ts">
  /**
   * Web Push subscribe/unsubscribe. Lifted out of the navbar so the desktop nav row and the
   * mobile overflow sheet share one implementation rather than the sheet doing without.
   *
   * "checking" and "busy" render an inert control of the same width as the real one, so
   * resolving the subscription never resizes the row after paint.
   */
  import { onMount } from "svelte";
  import { PUBLIC_VAPID_KEY } from '$app/env/public';
  import { toasts } from "#lib/toast.svelte.js";
  import { net } from "#lib/offline/net.js";
  import Switch from "#lib/components/Switch.svelte";

  interface Props {
    /** `bar` is the desktop nav pill; `row` is a bare switch whose label the caller renders. */
    variant?: "bar" | "row";
    /** Id of the element naming the `row` switch. */
    labelledby?: string;
  }

  let { variant = "bar", labelledby }: Props = $props();

  type NotifState = "checking" | "unsupported" | "denied" | "unsubscribed" | "subscribed" | "busy";
  let state = $state<NotifState>("checking");

  onMount(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      state = "unsupported";
      return;
    }
    if (Notification.permission === "denied") {
      state = "denied";
      return;
    }
    const sw = await navigator.serviceWorker.ready;
    state = await sw.pushManager.getSubscription() ? "subscribed" : "unsubscribed";
  });

  function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
    const padding = ("=").repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function toggle() {
    state = "busy";
    try {
      const sw = await navigator.serviceWorker.ready;
      const existing = await sw.pushManager.getSubscription();

      if (existing) {
        await net("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        state = "unsubscribed";
        toasts.show("Notifications off.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        state = "denied";
        return;
      }

      const sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
      });

      await net("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      state = "subscribed";
      toasts.success("Notifications on.");
    } catch (err) {
      console.error("[push]", err);
      state = "unsubscribed";
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  }

  const hidden = $derived(state === "unsupported" || state === "denied");
</script>

{#if !hidden}
  {#if variant === "row"}
    <button
      type="button"
      role="switch"
      aria-checked={state === "subscribed"}
      aria-labelledby={labelledby}
      onclick={toggle}
      disabled={state === "checking" || state === "busy"}
      class="tap inline-flex shrink-0 items-center justify-center cursor-pointer disabled:opacity-50"
    >
      <Switch checked={state === "subscribed"} />
    </button>
  {:else if state === "subscribed"}
    <button onclick={toggle} class="nav-btn border-success-700 text-success-400 hover:bg-surface-800 cursor-pointer">
      Notify ✓
    </button>
  {:else if state === "unsubscribed"}
    <button onclick={toggle} class="nav-btn nav-btn-muted cursor-pointer">Notify</button>
  {:else}
    <span class="nav-btn nav-btn-muted opacity-50 select-none">Notify</span>
  {/if}
{/if}
