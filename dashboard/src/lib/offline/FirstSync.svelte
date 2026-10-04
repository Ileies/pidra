<script lang="ts">
  /**
   * The one screen that waits on the network: the mirror is empty,
   * because this is the first launch on the device or "Clear offline data" just ran, so there is
   * nothing local to show. The root layout renders it in place of a mirrored page whose load said
   * `mirrorEmpty`; the sync that fills the mirror re-runs that load, and the page takes its place.
   *
   * A designed state rather than a blank loading bar, and an honest one when the download cannot
   * happen: offline on a device that has never synced has no data at all, and says so.
   */
  import Page from "#lib/components/Page.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { offline } from "./state.svelte.js";

  const stuck = $derived(!offline.syncing && (offline.lastResult === "offline" || offline.lastResult === "failed" || offline.isOffline));
</script>

<Page title="First sync" size="read">
  <div class="mx-auto max-w-md py-16 flex flex-col items-center gap-3 text-center">
    {#if stuck}
      <h1 class="text-lg font-semibold text-surface-100">Nothing stored on this device yet</h1>
      <p class="text-sm text-surface-400 max-w-prose">
        {offline.isOffline
          ? "The dashboard server is not reachable. Open the app once with a connection and it works offline from then on."
          : "The offline copy could not be downloaded. The server answered, so trying again usually works."}
      </p>
      <button
        type="button"
        onclick={() => offline.syncNow()}
        class="btn btn-md btn-ghost mt-2"
      >
        Try again
      </button>
    {:else}
      <Spinner size="md" label="Downloading the offline copy" />
      <h1 class="text-lg font-semibold text-surface-100">Downloading the offline copy</h1>
      <p class="text-sm text-surface-400 max-w-prose">
        The last 60 briefings, your notes, the rules and the context document, once. After this the
        app opens from this device, with or without a connection.
      </p>
    {/if}
  </div>
</Page>
