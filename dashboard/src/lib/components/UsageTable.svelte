<script lang="ts" generics="Row">
  /** A right-aligned figures table: one row-header cell per row, a value per column, an optional total row. */
  import type { Snippet } from "svelte";

  interface Props {
    caption: string;
    first: string;
    columns: readonly { header: string; value: (row: Row) => string }[];
    rows: readonly Row[];
    key: (row: Row) => string;
    rowHeader: Snippet<[Row]>;
    total?: { label: string; values: readonly string[] };
  }

  let { caption, first, columns, rows, key, rowHeader, total }: Props = $props();

  const last = $derived(columns.length - 1);
</script>

<div class="overflow-x-auto">
  <table class="w-full text-xs tabular-nums">
    <caption class="sr-only">{caption}</caption>
    <thead class="text-surface-400 text-left">
      <tr>
        <th scope="col" class="font-normal pb-1 pr-3">{first}</th>
        {#each columns as column, i (column.header)}
          <th scope="col" class="font-normal pb-1 text-right {i < last ? 'pr-3' : ''}">{column.header}</th>
        {/each}
      </tr>
    </thead>
    <tbody class="text-surface-200">
      {#each rows as row (key(row))}
        <tr class="border-t border-surface-800">
          <th scope="row" class="font-normal text-left py-1.5 pr-3 whitespace-nowrap">{@render rowHeader(row)}</th>
          {#each columns as column, i (column.header)}
            <td class="py-1.5 text-right {i < last ? 'pr-3' : ''}">{column.value(row)}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
    {#if total}
      <tfoot class="text-surface-50">
        <tr class="border-t border-surface-600">
          <th scope="row" class="font-medium text-left py-1.5 pr-3">{total.label}</th>
          {#each total.values as value, i (i)}
            <td class="py-1.5 text-right {i < last ? 'pr-3' : ''}">{value}</td>
          {/each}
        </tr>
      </tfoot>
    {/if}
  </table>
</div>
