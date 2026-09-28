<script lang="ts">
  /**
   * The header's sync glyph: a cloud, the way every synced SaaS app shows it - plain while
   * caught up, the one shared `Spinner` while a pull is in flight, crossed out while unreachable.
   * Tapping it opens the sync sheet for the detail (queued/failed lists, last-synced time). A sheet
   * rather than a route on purpose: `routes.ts` and `src/ai/surfaces.ts` stay untouched and
   * `check-route-surfaces.ts` has nothing new to verify.
   *
   * `offline.start()` runs once here rather than in the root layout directly, mirroring how
   * `Assistant.svelte` calls `assistant.restore()`: an effect only ever runs client-side, so this
   * is the established way to do a browser-only one-time setup from a component the layout mounts
   * unconditionally.
   */
  import { offline } from "#lib/offline/state.svelte.js";
  import Spinner from "#lib/components/Spinner.svelte";

  $effect(() => {
    offline.start();
  });

  // Every part that applies, so a count never hides that the app is offline, or the other way round.
  const label = $derived(
    [
      offline.syncing ? "Syncing" : offline.reachable === "offline" ? "Offline" : offline.reachable === "checking" ? "Checking" : null,
      offline.failed.length > 0 ? `${offline.failed.length} not saved` : null,
      offline.queuedCount > 0 ? `${offline.queuedCount} queued` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Synced",
  );

  const cloudClass = $derived(
    offline.reachable === "offline"
      ? "text-error-500"
      : offline.failed.length > 0
        ? "text-error-500"
        : offline.queuedCount > 0
          ? "text-warning-500"
          : offline.reachable === "checking"
            ? "text-surface-500 animate-pulse"
            : "text-surface-400",
  );
</script>

<button
  type="button"
  onclick={() => offline.toggleSheet()}
  aria-haspopup="dialog"
  aria-expanded={offline.sheetOpen}
  title={label}
  class="tap flex items-center justify-center rounded-full h-8 w-8 hover:bg-surface-800 cursor-pointer transition-colors shrink-0"
>
  {#if offline.syncing}
    <Spinner size="sm" label="Syncing" />
  {:else if offline.reachable === "offline"}
    <svg viewBox="0 0 24 24" class="h-5 w-5 {cloudClass}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3M1 1l22 22" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" class="h-5 w-5 {cloudClass}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  {/if}
  <span class="sr-only">{label}</span>
</button>
