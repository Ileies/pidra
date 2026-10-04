<script lang="ts">
  /**
   * One plain line above the briefing, shown until the reader has opened an entry or dismissed it:
   * entries have no button, so this is where a new reader learns that a tap opens one.
   */
  import { onMount } from "svelte";
  import { entryHint, loadEntryHint, markEntryHintSeen } from "#lib/report/entry-hint.svelte.js";

  onMount(loadEntryHint);
</script>

{#if !entryHint.seen}
  <p class="flex items-center gap-2 text-xs text-surface-400">
    <span>Tap a story to see where it came from.</span>
    <button
      type="button"
      onclick={markEntryHintSeen}
      aria-label="Dismiss this hint"
      class="rounded px-1.5 text-surface-400 hover:text-surface-200 transition-colors"
    >
      <span aria-hidden="true">×</span>
    </button>
  </p>
{/if}
