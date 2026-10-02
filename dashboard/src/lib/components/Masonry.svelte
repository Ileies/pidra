<script lang="ts" generics="T">
  /**
   * A stack of cards in 1, 2 or 3 columns.
   *
   * CSS `columns` fills down and then across, so "newest first" put the second note at the bottom of
   * the first column, and a card that grew (an open editor) could push a neighbour into the next
   * column. Here item `i` goes to column `i % n`: reading order is left to right, row by row, and a
   * card growing in place moves nothing but the cards beneath it in its own column.
   */
  import type { Snippet } from "svelte";

  interface Props {
    items: T[];
    key: (item: T) => string;
    /** Rendered above the first column's items, e.g. a composer. Shown even with no items. */
    lead?: Snippet;
    children: Snippet<[T]>;
  }

  let { items, key, lead, children }: Props = $props();

  // Measured from the container, not the viewport: the page's width cap grows with the viewport,
  // so the thresholds below describe the room the cards actually have. The viewport guess only
  // covers the frames before the first measurement.
  let width = $state(typeof window === "undefined" ? 0 : window.innerWidth - 32);
  const count = $derived(width >= 1300 ? 3 : width >= 600 ? 2 : 1);

  const columns = $derived.by(() => {
    const out: T[][] = Array.from({ length: count }, () => []);
    items.forEach((item, i) => out[i % count].push(item));
    return out;
  });
</script>

<div bind:clientWidth={width} class="flex items-start gap-3">
  {#each columns as column, c (c)}
    <div class="flex min-w-0 flex-1 flex-col gap-3">
      {#if c === 0}{@render lead?.()}{/if}
      {#each column as item (key(item))}
        {@render children(item)}
      {/each}
    </div>
  {/each}
</div>
