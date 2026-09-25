<script lang="ts">
  /**
   * The header dot. Online, offline, or "N queued" - tapping it opens the
   * sync sheet. A sheet rather than a route on purpose: `routes.ts` and `src/ai/surfaces.ts` stay
   * untouched and `check-route-surfaces.ts` has nothing new to verify.
   *
   * `offline.start()` runs once here rather than in the root layout directly, mirroring how
   * `Assistant.svelte` calls `assistant.restore()`: an effect only ever runs client-side, so this
   * is the established way to do a browser-only one-time setup from a component the layout mounts
   * unconditionally.
   */
  import { offline } from "#lib/offline/state.svelte.js";

  $effect(() => {
    offline.start();
  });

  // Every part that applies, so a count never hides that the app is offline, or the other way round.
  const label = $derived(
    [
      offline.reachable === "offline" ? "Offline" : offline.reachable === "checking" ? "Checking" : null,
      offline.failed.length > 0 ? `${offline.failed.length} not saved` : null,
      offline.queuedCount > 0 ? `${offline.queuedCount} queued` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Online",
  );

  const dotClass = $derived(
    offline.failed.length > 0
      ? "bg-error-500"
      : offline.queuedCount > 0
      ? "bg-warning-500"
      : offline.reachable === "online"
        ? "bg-success-500"
        : offline.reachable === "checking"
          ? "bg-surface-500"
          : "bg-error-500",
  );
</script>

<button
  type="button"
  onclick={() => offline.toggleSheet()}
  aria-haspopup="dialog"
  aria-expanded={offline.sheetOpen}
  class="tap flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-950 px-2 py-1 text-xs text-surface-300 hover:bg-surface-800 cursor-pointer transition-colors shrink-0"
>
  <span class="h-2 w-2 rounded-full {dotClass}" aria-hidden="true"></span>
  <span class="hidden md:inline">{label}</span>
  <span class="sr-only md:hidden">{label}</span>
</button>
