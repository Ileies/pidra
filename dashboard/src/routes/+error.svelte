<script lang="ts">
  /**
   * The one error boundary for the app. Its offline job: a page that could
   * not load because pronix was not reachable shows `OfflineNotice`, never "500 Internal Error".
   *
   * It decides from the error, not from the header dot. The first version asked
   * `offline.reachable`, which only a separate health probe moved, so a Questions tap on a dead
   * network produced a 500 while the dot still said online. Now `net.ts` marks the error itself:
   * `page.error.offline` arrives either as a field of the synthetic `__data.json` answer or via
   * `handleError` in `hooks.client.ts`. A genuine 404 or 500 while reachable still shows its
   * status, because dressing that up as "needs the connection" would send the reader to look at
   * the wrong thing.
   */
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import Page from "#lib/components/Page.svelte";
  import OfflineNotice from "#lib/components/OfflineNotice.svelte";
  import { offline } from "#lib/offline/state.svelte.js";
  import { routeFor } from "#lib/routes.js";
  import { onlineOnlyFor } from "#lib/offline/onlineOnly.js";

  const isOffline = $derived(page.error?.offline === true);
  const notice = $derived(
    onlineOnlyFor(page.url.pathname) ?? {
      label: routeFor(page.route.id)?.label ?? "This page",
      reason: "It could not reach the dashboard server.",
    },
  );

  let retrying = $state(false);
  // Set for the whole span of a manual retry, including the probe before it - `retrying` alone
  // only covers the `goto()` itself, leaving a window where `probe()` has already flipped
  // `offline.reachable` to "online" but the explicit `retry()` below hasn't started yet. Without
  // this, the reachability effect below sees that same transition and fires its own `retry()`,
  // so one click produced two concurrent navigations to the same URL.
  let manualRetryPending = false;

  async function retry() {
    if (retrying) return;
    retrying = true;
    try {
      await goto(page.url.href, { refreshAll: true, replace: true, reset: false });
    } finally {
      retrying = false;
    }
  }

  /** The Try again button: probe first, because while offline a reload would fail in one frame. */
  async function retryWhenReachable() {
    manualRetryPending = true;
    try {
      if (await offline.probe()) await retry();
    } finally {
      manualRetryPending = false;
    }
  }

  // Coming back online takes the reader back to the page they asked for, without a tap. Only on
  // the transition, so a page that fails again for a different reason cannot loop, and never
  // while a manual retry (above) is already handling that same transition itself.
  let lastReachable = offline.reachable;
  $effect(() => {
    const now = offline.reachable;
    if (isOffline && now === "online" && lastReachable !== "online" && !manualRetryPending) void retry();
    lastReachable = now;
  });
</script>

{#if isOffline}
  <OfflineNotice label={notice.label} reason={notice.reason} onRetry={retryWhenReachable} busy={retrying || offline.reachable === "checking"} />
{:else}
  <Page title="Error" size="read">
    <div class="flex flex-col items-center gap-3 py-16 text-center">
      <h1 class="text-lg font-semibold text-surface-100">{page.status}</h1>
      <p class="text-sm text-surface-400 max-w-prose">{page.error?.message ?? "Something went wrong."}</p>
      {#if page.status >= 500}
        <p class="text-xs text-surface-500 max-w-prose">The server answered but failed. <a href="/runs">Runs</a> and the dashboard's journal on pronix say more.</p>
      {/if}
      <button
        type="button"
        onclick={retry}
        disabled={retrying}
        class="btn btn-md btn-solid mt-2"
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  </Page>
{/if}
