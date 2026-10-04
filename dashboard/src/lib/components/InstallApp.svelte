<script lang="ts">
  /**
   * The "App" card on the settings page. What it shows is decided by what the browser can
   * actually tell or do (see `$lib/pwa.svelte.ts`): no uninstall control, because no browser exposes
   * one, and "Open the app" only where an installed app is both detectable and reachable from a tab.
   * The wording avoids "PWA" on purpose.
   */
  import { onMount } from "svelte";
  import Card from "#lib/components/Card.svelte";
  import { pwa } from "#lib/pwa.svelte.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { toasts } from "#lib/toast.svelte.js";

  let busy = $state(false);

  onMount(() => {
    if (offline.isOffline) pwa.detected = true;
    else void pwa.refresh();
  });

  async function install() {
    busy = true;
    try {
      if (await pwa.install()) toasts.success("PIDRA installed.");
    } finally {
      busy = false;
    }
  }

  const installed = $derived(pwa.inApp || (pwa.detected && pwa.installedInBrowser));
  const checking = $derived(!pwa.inApp && !pwa.detected);
  // The browser may still be about to offer its install dialog (Chromium does it ~100 ms after load).
  const waiting = $derived(pwa.promptSupported && !pwa.canPrompt && !pwa.promptWaitOver && !pwa.dismissed);
  // Installing with a button is not possible here: say so up front instead of after a click.
  const unavailable = $derived(!installed && !checking && !pwa.canPrompt && !waiting);

  const title = $derived(checking ? "PIDRA app" : installed ? "PIDRA is installed" : "Install PIDRA");
  const hint = $derived(
    pwa.inApp
      ? "You are using the app right now."
      : checking
        ? "Checking this device..."
        : installed
          ? "You are using it in the browser right now."
          : "Open it in its own window, like any other app on this device.",
  );

  const button = "btn btn-lg btn-primary w-full sm:w-auto shrink-0 font-medium";
</script>

<Card as="section" class="px-4 sm:px-5 py-4 flex flex-col gap-4">
  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex min-w-0 items-center gap-4">
      <div class="relative shrink-0">
        <img
          src="/icons/icon-192.png"
          alt=""
          width="48"
          height="48"
          class="size-12 rounded-xl ring-1 ring-surface-700 {checking ? 'opacity-60' : ''}"
        />
        {#if installed}
          <span
            class="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-success-600 text-surface-50 ring-2 ring-surface-900"
          >
            <svg viewBox="0 0 16 16" class="size-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          </span>
        {/if}
      </div>
      <div class="flex min-w-0 flex-col gap-0.5">
        <h2 class="text-sm font-semibold text-surface-100">{title}</h2>
        <p class="text-xs text-surface-400">{hint}</p>
      </div>
    </div>

    {#if !pwa.inApp}
      {#if !installed}
        <button type="button" onclick={install} disabled={busy || checking || !pwa.canPrompt} class={button}>
          <svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" />
          </svg>
          {busy ? "Installing..." : "Install"}
        </button>
      {:else if pwa.desktopChromium}
        <a href="/" target="_blank" rel="noopener" class={button}>
          Open the app
          <svg viewBox="0 0 20 20" class="size-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M12 4h4v4m0-4l-7 7" />
          </svg>
        </a>
      {/if}
    {/if}
  </div>

  {#if unavailable}
    <Card tone="inset" class="px-4 py-3 text-xs text-surface-300">
      <p class="mb-2 text-surface-400">
        {#if pwa.dismissed}
          You closed the install dialog. Reload this page to get it back, or do this instead:
        {:else if pwa.promptSupported}
          Your browser isn't offering to install right now. Do this instead:
        {:else}
          This browser can't install apps with a button. Do this instead:
        {/if}
      </p>
      {#if pwa.ios}
        <ol class="flex list-decimal flex-col gap-1 pl-4 marker:text-surface-500">
          <li>Tap the Share button in Safari.</li>
          <li>Choose "Add to Home Screen".</li>
        </ol>
      {:else}
        <ol class="flex list-decimal flex-col gap-1 pl-4 marker:text-surface-500">
          <li>Open your browser's menu.</li>
          <li>Choose "Install app" or "Add to Home screen".</li>
        </ol>
      {/if}
    </Card>
  {/if}
</Card>
