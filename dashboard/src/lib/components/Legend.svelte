<script lang="ts">
  /** Colour key for a chart: one swatch and label per entry. */
  interface Props {
    items: readonly { id: string; label: string; color: string }[];
  }

  let { items }: Props = $props();
</script>

<ul class="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
  {#each items as item (item.id)}
    <li class="flex items-center gap-1.5 text-xs text-surface-300">
      <span class="inline-block w-3 h-3 rounded-sm" style="background:{item.color}"></span>
      {item.label}
    </li>
  {/each}
</ul>
