<script lang="ts" generics="G extends { entries: RenderedEntry[] }">
  /**
   * The wrapper shape Section 2 (personal) and the Intelligence Briefing (intel) both repeat: a
   * `<section>` with a heading, a list of groups, each with its own per-group heading and a list of
   * entries. What differs - the group heading's content, any extra props an entry needs, a
   * per-group scroll target, and personal's trailing "quick actions" block - is left to the caller
   * via snippets, so this only ever holds the repeated skeleton.
   */
  import type { Snippet } from "svelte";
  import type { RenderedEntry } from "#lib/server/reports.js";

  interface Props {
    id: string;
    title: string;
    groups: G[];
    /** Section-level vertical gap; personal and intel use different values. */
    gapClass?: string;
    groupKey: (group: G, index: number) => string | number;
    /** Intel groups are individual scroll/jump targets; personal groups are not. */
    groupWrapper?: (group: G, index: number) => { id?: string } | undefined;
    header: Snippet<[G, number]>;
    entry: Snippet<[RenderedEntry, number, G]>;
    footer?: Snippet;
  }

  let { id, title, groups, gapClass = "gap-5", groupKey, groupWrapper, header, entry, footer }: Props = $props();
</script>

<section {id} tabindex="-1" class="flex flex-col {gapClass} scroll-mt-[calc(var(--header-h)+3.5rem)]">
  <h2 class="text-lg font-semibold text-surface-50 border-b border-surface-700 pb-2">
    {title}
  </h2>

  {#each groups as group, index (groupKey(group, index))}
    {@const wrap = groupWrapper?.(group, index)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- always -1 or absent, never nonnegative (see groupWrapper) -->
    <div
      id={wrap?.id}
      tabindex={wrap?.id ? -1 : undefined}
      class="flex flex-col gap-3 {wrap?.id ? 'scroll-mt-[calc(var(--header-h)+3.5rem)]' : ''}"
    >
      {@render header(group, index)}
      {#each group.entries as e, entryIndex (entryIndex)}
        {@render entry(e, entryIndex, group)}
      {/each}
    </div>
  {/each}

  {@render footer?.()}
</section>
