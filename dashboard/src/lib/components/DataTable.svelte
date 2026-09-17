<script lang="ts" generics="Row">
  /**
   * One table, two responsive strategies (B2, M-5).
   *
   * Three of the app's four tables had no responsive treatment at all: /sources was six columns
   * including an inline text input and a three-button confirm dance with no `overflow-x`
   * wrapper, so the whole page panned sideways on a phone. /entities was the one that got it
   * right, with `overflow-x-auto` plus progressive `hidden sm:table-cell` columns, and that is
   * the `scroll` mode here.
   *
   * - `mode="cards"`  below `md` the rows become a stacked card list. For a table whose row is
   *                   really an object with a name and some facts about it.
   * - `mode="scroll"` the table stays a table, scrolls inside its own container, and columns
   *                   appear progressively. For a dense numeric table where the grid *is* the
   *                   information.
   *
   * Either way the page itself never scrolls horizontally.
   */
  import type { Snippet } from "svelte";
  import { ALIGN, SHOW_AT, type Column } from "#lib/components/table.js";
  import EmptyState from "#lib/components/EmptyState.svelte";

  interface Props {
    rows: Row[];
    columns: Column<Row>[];
    /** Stable identity per row. */
    key: (row: Row) => string;
    mode?: "cards" | "scroll";
    /** Shown instead of the table when there are no rows. */
    emptyTitle?: string;
    emptyHint?: string;
    empty?: Snippet;
    /** Rows that are switched off, disabled, or otherwise not in play. */
    dim?: (row: Row) => boolean;
    /** Highlight ring, e.g. a row the assistant just changed. */
    highlight?: (row: Row) => boolean;
    caption?: string;
  }

  let {
    rows,
    columns,
    key,
    mode = "cards",
    emptyTitle = "Nothing here yet.",
    emptyHint,
    empty,
    dim,
    highlight,
    caption,
  }: Props = $props();

  const titleColumn = $derived(columns.find((column) => column.card === "title"));
  const metaColumns = $derived(columns.filter((column) => column.card === "meta"));
  const rowColumns = $derived(
    columns.filter((column) => (column.card ?? "row") === "row" && column !== titleColumn),
  );
  const actionColumns = $derived(columns.filter((column) => column.card === "actions"));
</script>

{#if rows.length === 0}
  {#if empty}
    {@render empty()}
  {:else}
    <EmptyState title={emptyTitle} hint={emptyHint} />
  {/if}
{:else}
  <!-- Table. In `cards` mode it only exists from `md` up. -->
  <div class="overflow-x-auto rounded-lg border border-surface-700 {mode === 'cards' ? 'hidden md:block' : ''}">
    <table class="w-full text-sm">
      {#if caption}
        <caption class="sr-only">{caption}</caption>
      {/if}
      <thead>
        <tr class="border-b border-surface-700 bg-surface-900">
          {#each columns as column (column.key)}
            <th
              scope="col"
              class="px-3 py-2.5 font-medium text-surface-400 whitespace-nowrap
                {ALIGN[column.align ?? 'left']} {column.showAt ? SHOW_AT[column.showAt] : ''} {column.width ?? ''}"
            >
              {column.header}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (key(row))}
          <tr
            class="border-b border-surface-800 last:border-b-0 transition-colors hover:bg-surface-900/60
              {dim?.(row) ? 'opacity-50' : ''} {highlight?.(row) ? 'ring-1 ring-inset ring-primary-600' : ''}"
          >
            {#each columns as column (column.key)}
              <td class="px-3 py-2.5 align-top {ALIGN[column.align ?? 'left']} {column.showAt ? SHOW_AT[column.showAt] : ''}">
                {@render column.cell(row)}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Cards, below `md`. -->
  {#if mode === "cards"}
    <div class="flex flex-col gap-2 md:hidden">
      {#each rows as row (key(row))}
        <article
          class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-3 flex flex-col gap-2
            {dim?.(row) ? 'opacity-60' : ''} {highlight?.(row) ? 'ring-1 ring-primary-600' : ''}"
        >
          {#if titleColumn}
            <div class="text-sm font-medium text-surface-100 break-words">
              {@render titleColumn.cell(row)}
            </div>
          {/if}

          {#if metaColumns.length > 0}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-400">
              {#each metaColumns as column (column.key)}
                {@render column.cell(row)}
              {/each}
            </div>
          {/if}

          {#if rowColumns.length > 0}
            <dl class="grid grid-cols-[minmax(0,auto)_1fr] gap-x-3 gap-y-1 text-xs">
              {#each rowColumns as column (column.key)}
                <dt class="text-surface-400">{column.header}</dt>
                <dd class="text-surface-200 text-right tabular-nums min-w-0 break-words">
                  {@render column.cell(row)}
                </dd>
              {/each}
            </dl>
          {/if}

          {#each actionColumns as column (column.key)}
            <div class="pt-1">{@render column.cell(row)}</div>
          {/each}
        </article>
      {/each}
    </div>
  {/if}
{/if}
