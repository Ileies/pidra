<script lang="ts">
  /**
   * Inline word diff, for a correction's before/after (D6's line-level `Diff.svelte` is the wrong
   * grain here: a correction is a sentence or two, not a document, so showing it as two stacked
   * blocks made the reader do the comparison in their head. One flowing paragraph, struck-through
   * removals and highlighted additions inline, is what "diff" means at this size.
   */
  import { diffWords } from "diff";

  interface Props {
    before: string;
    after: string;
  }

  let { before, after }: Props = $props();

  const parts = $derived(diffWords(before, after));
</script>

<span class="whitespace-pre-wrap break-words">
  {#each parts as part, i (i)}
    {#if part.added}
      <ins class="no-underline bg-success-950 text-success-300 rounded-sm px-0.5">{part.value}</ins>
    {:else if part.removed}
      <del class="text-surface-500 rounded-sm px-0.5">{part.value}</del>
    {:else}
      {part.value}
    {/if}
  {/each}
</span>
