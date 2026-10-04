<script lang="ts">
  /**
   * "A new version is ready", rendered inside the header. Never automatic: taking over mid-read
   * would reload the page under the reader.
   *
   * From `md` up it hangs from the top edge of the screen as a tab: a body with a curved shoulder
   * on each side that sweeps out to the edge at a shallow angle and drops steeply into the box.
   * The pieces are opaque and the wrapper carries the opacity, so the seams never show. Below `md`
   * there is no room for a sentence: the button shrinks to a refresh icon with a dot, the same
   * 40px square as Settings.
   */
  import { appUpdate } from "#lib/offline/update.svelte.js";
</script>

{#snippet shoulder(mirrored: boolean)}
  <svg viewBox="0 0 64 48" class="hidden h-12 w-16 shrink-0 overflow-visible md:block {mirrored ? '-ml-px -scale-x-100' : '-mr-px'}" aria-hidden="true">
    <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 48 53 48H64V0Z" class="fill-surface-900" />
    <path d="M0 0C18 0 30 5 35 22L39 38C41 45 45 47.5 53 47.5H64" fill="none" class="stroke-surface-600" />
  </svg>
{/snippet}

<div role="status" class="flex shrink-0 items-center gap-2 text-xs text-surface-200 max-md:ml-auto md:fixed md:left-1/2 md:top-0 md:z-10 md:h-12 md:-translate-x-1/2 md:gap-0 md:opacity-95 md:drop-shadow-[0_6px_12px_rgb(0_0_0/0.4)]">
  {@render shoulder(false)}
  <div class="contents md:flex md:h-full md:items-center md:gap-3 md:px-2 md:border-b md:border-surface-600 md:bg-surface-900">
    <span class="hidden md:inline">A new version of PIDRA is ready.</span>
    <button
      type="button"
      onclick={() => appUpdate.apply()}
      aria-label="Reload: a new version of PIDRA is ready"
      title="A new version of PIDRA is ready"
      class="tap relative flex h-10 w-10 items-center justify-center rounded-lg border border-primary-700 bg-primary-900 text-primary-200 hover:bg-primary-800 md:h-auto md:w-auto md:rounded md:px-3 md:py-1"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5 md:hidden" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
      </svg>
      <span class="hidden md:inline">Reload</span>
      <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-primary-400 ring-2 ring-surface-950 md:hidden" aria-hidden="true"></span>
    </button>
  </div>
  {@render shoulder(true)}
</div>
