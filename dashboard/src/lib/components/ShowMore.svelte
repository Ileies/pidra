<script lang="ts">
  /** The "Show more (N more)" button under a list that is shown a page at a time (`Paged`). */
  import type { Paged } from "#lib/ui/paged.svelte.js";

  let { pager, total }: { pager: Paged; total: number } = $props();
</script>

{#if pager.visible < total}
  <button
    type="button"
    onclick={() => pager.more()}
    class="btn btn-sm btn-ghost self-start"
  >Show more ({total - pager.visible} more)</button>
{/if}
