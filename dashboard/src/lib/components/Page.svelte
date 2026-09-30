<script lang="ts">
  /**
   * The page frame (B1, M-2).
   *
   * Ten pages hand-rolled `<div class="flex flex-1 flex-col min-h-0"><main class="max-w-{2..6}xl
   * w-full mx-auto px-{6,8} py-{6,8} pb-16">`, picking one of seven container widths and one of
   * two paddings per page. All of that lives here now, so a page's top-level markup is one
   * element and the padding is responsive everywhere at once.
   *
   * `bleed` renders full-width above the container, for the one thing that legitimately spans
   * the viewport: the report's stats bar.
   */
  import type { Snippet } from "svelte";
  import { PAGE_PADDING, PAGE_SIZES, PAGE_VERTICAL, type PageSize } from "#lib/ui/layout.js";

  interface Props {
    size?: PageSize;
    /** Browser tab title. `PIDRA - ` is prepended. */
    title?: string;
    /** Full-width band directly under the header, inside the page scroller. */
    bleed?: Snippet;
    /** Extra classes on `<main>`, for a page that needs its own flex or gap. */
    class?: string;
    children: Snippet;
  }

  let { size = "app", title, bleed, class: extra = "", children }: Props = $props();
</script>

<svelte:head>
  <title>{title ? `PIDRA - ${title}` : "PIDRA"}</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
  {@render bleed?.()}
  <main class="flex-1 w-full mx-auto {PAGE_SIZES[size]} {PAGE_PADDING} {PAGE_VERTICAL} {extra}">
    {@render children()}
  </main>
</div>
