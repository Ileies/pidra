<script lang="ts">
  /** A wrapping row of "term value" pairs, shared by the run page's Time and Cost cards so they look alike. */
  interface Props {
    items: readonly (readonly [string, string])[];
  }

  let { items }: Props = $props();
</script>

<dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs">
  {#each items as [term, value] (term)}
    <div class="flex items-baseline gap-1.5">
      <dt class="text-surface-400">{term}</dt>
      <dd class="text-surface-100 font-medium tabular-nums">{value}</dd>
    </div>
  {/each}
</dl>
