<script lang="ts">
  /**
   * The horizontal run of figures under the header (the report uses it in `Page`'s `bleed`). A grid: two
   * columns on a phone, auto-flow above, with the separator drawn as a border rather than a
   * glyph so it can never wrap orphaned onto a line start.
   */
  import type { Snippet } from "svelte";

  export interface Stat {
    label: string;
    value: string | number;
    /** Shown on hover and long-press, for a figure with something behind it (e.g. cost). */
    title?: string;
  }

  interface Props {
    stats: Stat[];
    /** Trailing content, e.g. a link to the run detail. */
    children?: Snippet;
  }

  let { stats, children }: Props = $props();
</script>

<div class="bg-surface-900 border-b border-surface-700">
  <div
    class="mx-auto w-full max-w-app px-4 sm:px-6 lg:px-8 py-2
           grid grid-cols-2 sm:flex sm:flex-wrap sm:items-baseline gap-x-5 gap-y-1"
  >
    {#each stats as stat (stat.label)}
      <span class="flex items-baseline gap-1.5 text-xs min-w-0" title={stat.title}>
        <span class="font-semibold text-surface-50 tabular-nums">{stat.value}</span>
        <span class="text-surface-400 truncate">{stat.label}</span>
      </span>
    {/each}
    {@render children?.()}
  </div>
</div>
