<script lang="ts">
  /**
   * One entry of the briefing: the prose, the rating controls, and the expansion (C4, C5).
   *
   * "More on this" used to navigate to `/[date]/detail/[ids]`, which lost the reader's place in
   * a report several screens long. It expands the same extraction cards in place now; the deep
   * link stays as the shareable form and as the fallback for a browser with no JS.
   *
   * The cards come from the mirror (OFFLINE_PLAN.md H3), which holds every extraction a mirrored
   * report cites, so they open in the same frame online or not. This used to be a request per
   * tap, which offline meant a spinner and then an error under a report that was otherwise fine.
   */
  import { extractionsFor, type MirroredExtraction } from "#lib/offline/repo.js";
  import ExtractionCard from "#lib/report/ExtractionCard.svelte";
  import RateButtons from "#lib/report/RateButtons.svelte";
  import type { RenderedEntry } from "#lib/server/reports.js";

  interface Props {
    entry: RenderedEntry;
    date: string;
    ratings: Record<string, string | null>;
    onRate: (extractionId: string, eventType: string | null) => void;
    /** A left accent bar, for the urgency groups in Section 2. */
    accent?: string;
  }

  let { entry, date, ratings, onRate, accent }: Props = $props();

  let open = $state(false);
  let items = $state<MirroredExtraction[] | null>(null);

  const href = $derived(`/${date}/detail/${entry.refIds.join(",")}`);
  const missing = $derived(items ? entry.refIds.length - items.length : 0);

  async function toggle(event: MouseEvent) {
    // Modifier-clicks and middle clicks stay navigations: the deep link is real and shareable.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();

    open = !open;
    // Read on every open rather than once: a rating given since, or a sync, is in the mirror.
    if (open) items = await extractionsFor(null, entry.refIds);
  }
</script>

<div class="group flex flex-col gap-2 {accent ? `border-l-2 pl-3 ${accent}` : ''}">
  <div class="flex items-start gap-3">
    <div class="report-body min-w-0 flex-1 text-sm">
      {@html entry.html}
    </div>

    {#if entry.refIds.length > 0}
      <!-- Always present on a phone, revealed on hover or focus on a pointer device: a control
           that only exists on hover does not exist on a touch screen (M13). -->
      <div class="shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
        <RateButtons
          extractionId={entry.refIds[0]}
          rating={ratings[entry.refIds[0]] ?? null}
          {onRate}
        />
      </div>
    {/if}
  </div>

  {#if entry.refIds.length > 0}
    <div class="flex items-center gap-3">
      <a
        {href}
        onclick={toggle}
        aria-expanded={open}
        class="tap inline-flex items-center gap-1.5 self-start rounded border border-surface-700 bg-surface-900 px-2.5 py-1 text-xs text-surface-300 no-underline hover:border-primary-800 hover:text-primary-300 transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3 transition-transform {open ? 'rotate-90' : ''}" aria-hidden="true">
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        {open ? "Hide sources" : entry.refIds.length === 1 ? "More on this" : `More on this (${entry.refIds.length})`}
      </a>
    </div>
  {/if}

  {#if open}
    <div class="flex flex-col gap-2 pl-1">
      {#if missing > 0}
        <!-- Should not happen: the snapshot mirrors every extraction a mirrored report cites. If it
             does, say so rather than show fewer cards than the button promised. -->
        <p class="text-surface-400 text-xs">
          {missing === 1 ? "One source is" : `${missing} sources are`} not in the offline copy yet; the next sync brings
          {missing === 1 ? "it" : "them"}.
        </p>
      {/if}
      {#each items ?? [] as item (item.id)}
        <ExtractionCard {item} compact />
      {/each}
      {#if items}
        <a href={href} class="text-xs text-surface-400 hover:text-surface-200 self-start">Open the full detail page →</a>
      {/if}
    </div>
  {/if}
</div>
