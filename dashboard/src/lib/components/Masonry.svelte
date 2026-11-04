<script lang="ts" generics="T">
  /**
   * Height-balanced cards in 1, 2 or 3 columns, placed in source order into the shortest column.
   * Flat keyed wrappers keep editors mounted when measurements or the column count change.
   */
  import type { Snippet } from "svelte";
  import { masonryLayout } from "#lib/ui/masonry.js";

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
  let heights = $state<Record<string, number>>({});
  let leadHeight = $state(0);
  const layout = $derived(masonryLayout(items.map((item) => heights[key(item)] ?? 200), count, leadHeight));

  function measure(node: HTMLElement, id: string) {
    const observer = new ResizeObserver(() => {
      const height = node.getBoundingClientRect().height;
      if (heights[id] !== height) heights[id] = height;
    });
    observer.observe(node);
    return { destroy() { observer.disconnect(); delete heights[id]; } };
  }
</script>

<div
  bind:clientWidth={width}
  class="grid gap-x-3"
  style:grid-template-columns="repeat({count}, minmax(0, 1fr))"
  style:grid-template-rows="0px"
  style:height="{layout.height}px"
>
  <div bind:clientHeight={leadHeight} class="min-w-0 self-start" style:grid-area="1 / 1">
    {@render lead?.()}
  </div>
  {#each items as item, i (key(item))}
    <div
      use:measure={key(item)}
      class="min-w-0 self-start"
      style:grid-area="1 / {layout.positions[i].column + 1}"
      style:transform="translateY({layout.positions[i].top}px)"
    >
      {@render children(item)}
    </div>
  {/each}
</div>
