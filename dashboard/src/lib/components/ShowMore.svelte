<script lang="ts">
  /** The "Show more (N more)" button under a list that is shown a page at a time (`Paged`). */
  import type { Paged } from "#lib/ui/paged.svelte.js";

  let { pager, total }: { pager: Paged; total: number } = $props();
</script>

{#if pager.visible < total}
  <button
    type="button"
    onclick={() => pager.more()}
    class="tap self-start px-3 py-1.5 rounded text-xs border border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200 transition-colors cursor-pointer"
  >Show more ({total - pager.visible} more)</button>
{/if}
