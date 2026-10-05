<script lang="ts">
  /**
   * Inline word diff for short before/after text (a correction, a note revision): one flowing
   * paragraph with struck-through removals and highlighted additions.
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
