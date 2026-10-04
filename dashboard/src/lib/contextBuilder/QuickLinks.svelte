<script lang="ts">
  /** The wide-desktop rail: jumps into the document or a source summary, marking the one in view. */
  import { fmtNum } from "#lib/format.js";
  import type { DocHeading } from "#lib/searchHighlight.js";

  interface Props {
    headings: DocHeading[];
    summaries: { key: string; title: string; chars: number }[];
    activeId: string | null;
    onjump: (id: string, tab: "document" | "summaries") => void;
  }

  let { headings, summaries, activeId, onjump }: Props = $props();

  const link = (on: boolean) =>
    `tap text-left px-2 py-1 rounded text-xs transition-colors ${on ? "bg-primary-950 text-primary-300" : "text-surface-300 hover:bg-surface-800"}`;
</script>

<nav
  aria-label="Quick links"
  class="hidden xl:flex xl:flex-col gap-3 sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-var(--header-h)-2rem)] overflow-y-auto text-sm"
>
  {#if headings.length > 0}
    <div class="flex flex-col gap-0.5">
      <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Document</span>
      {#each headings as heading (heading.id)}
        <button type="button" class={link(activeId === heading.id)} onclick={() => onjump(heading.id, "document")}>
          {heading.title}
        </button>
      {/each}
    </div>
  {/if}
  {#if summaries.length > 0}
    <div class="flex flex-col gap-0.5">
      <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Source summaries</span>
      {#each summaries as section (section.key)}
        <button
          type="button"
          class="{link(activeId === `summary-${section.key}`)} flex items-baseline justify-between gap-2"
          onclick={() => onjump(`summary-${section.key}`, "summaries")}
        >
          <span>{section.title}</span>
          <span class="text-surface-500 tabular-nums shrink-0">{fmtNum(section.chars)}</span>
        </button>
      {/each}
    </div>
  {/if}
  <a href="/notes?scope=personal" class="tap px-2 py-1 text-xs text-primary-400 underline">Standing rules</a>
  <a href="/context-builder/corrections" class="tap px-2 py-1 text-xs text-primary-400 underline">Corrections</a>
</nav>
