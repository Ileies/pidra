<script lang="ts">
  /**
   * The page frame every route wraps itself in. `size` (read|app|form|legal) picks the container
   * width, padding is responsive; both are defined in `lib/ui/layout.ts`.
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
