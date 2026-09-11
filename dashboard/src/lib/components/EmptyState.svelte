<script lang="ts">
  /** Replaces eight one-off centered paragraphs, each with its own padding and colour. */
  import type { Snippet } from "svelte";

  interface Props {
    /** The one sentence that says why this is empty. */
    title: string;
    /** What to do about it, when there is something to do. */
    hint?: string;
    /** Smaller version, for an empty section inside a page rather than an empty page. */
    compact?: boolean;
    /** A button or link. */
    children?: Snippet;
  }

  let { title, hint, compact = false, children }: Props = $props();
</script>

<div class="flex flex-col items-center gap-2 text-center {compact ? 'py-6' : 'py-16'}">
  <p class="text-surface-200 text-sm">{title}</p>
  {#if hint}
    <p class="text-surface-400 text-xs max-w-prose">{hint}</p>
  {/if}
  {@render children?.()}
</div>
