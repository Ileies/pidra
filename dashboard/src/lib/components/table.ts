import type { Snippet } from "svelte";

/**
 * Column definition for `DataTable`.
 *
 * `showAt` (`scroll` mode): the column only appears in the table from that breakpoint up.
 * `card` (`cards` mode): below `md` the table becomes a list of cards, and this says what the
 * column is *in* a card. A column can use both. Give a cell either `value` or a `cell` snippet.
 */
export interface Column<Row> {
  /** Stable key, used for the `{#each}` and for nothing else. */
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  /** Appears in the table only from this breakpoint up. Omitted: always. */
  showAt?: "sm" | "md" | "lg";
  /** A width class on the `<th>`, e.g. `w-24`. */
  width?: string;
  /**
   * Role in the card layout below `md`:
   * - `title`   the card's heading line (exactly one per table)
   * - `meta`    inline under the title, comma-free, small
   * - `row`     a labelled value row
   * - `actions` pinned to the bottom of the card, full width
   * - `hidden`  not in the card at all
   * Defaults to `row`.
   */
  card?: "title" | "meta" | "row" | "actions" | "hidden";
  /** Markup for the cell. Use `value` instead when the cell is just one string. */
  cell?: Snippet<[Row]>;
  /** A plain-text cell: rendered in a `<span class={class}>`. */
  value?: (row: Row) => string;
  /** Classes for the span a `value` cell renders in. */
  class?: string;
}

export const ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export const SHOW_AT = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;
