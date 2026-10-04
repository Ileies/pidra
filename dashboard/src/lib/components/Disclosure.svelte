<script lang="ts">
  /**
   * A full-width trigger button with a body that exists only while open. `header` is the
   * trigger's content; `class` styles the trigger. Bind `open` for local state, or pass it with
   * `ontoggle` when the parent decides (one row open at a time).
   */
  import type { Snippet } from "svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";

  interface Props {
    open?: boolean;
    ontoggle?: (open: boolean) => void;
    chevron?: boolean;
    title?: string;
    class?: string;
    header: Snippet;
    children: Snippet;
  }

  let { open = $bindable(false), ontoggle, chevron = false, title, class: extra = "", header, children }: Props = $props();
</script>

<button
  type="button"
  aria-expanded={open}
  {title}
  onclick={() => {
    open = !open;
    ontoggle?.(open);
  }}
  class="w-full text-left {extra}"
>
  {#if chevron}
    <ChevronRight class="size-3 shrink-0 text-surface-400 transition-transform {open ? 'rotate-90' : ''}" aria-hidden="true" />
  {/if}
  {@render header()}
</button>
{#if open}
  {@render children()}
{/if}
