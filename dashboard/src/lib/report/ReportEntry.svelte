<script lang="ts">
  /**
   * One entry of the briefing: the prose, the rating controls, and the expansion (C4, C5).
   *
   * "More on this" used to navigate to `/[date]/detail/[ids]`, which lost the reader's place in
   * a report several screens long. It expands the same extraction cards in place now; the deep
   * link stays as the shareable form and as the fallback for a browser with no JS.
   */
  import Spinner from "$lib/components/Spinner.svelte";
  import ExtractionCard from "$lib/report/ExtractionCard.svelte";
  import RateButtons from "$lib/report/RateButtons.svelte";
  import type { ExtractionItem } from "$lib/server/extractions";
  import type { RenderedEntry } from "../../routes/[date]/+page.server";

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
  let items = $state<ExtractionItem[] | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const href = $derived(`/${date}/detail/${entry.refIds.join(",")}`);

  async function toggle(event: MouseEvent) {
    // Modifier-clicks and middle clicks stay navigations: the deep link is real and shareable.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();

    open = !open;
    if (!open || items || loading) return;

    loading = true;
    loadError = null;
    try {
      const res = await fetch(`/api/extractions?ids=${entry.refIds.join(",")}`);
      if (!res.ok) throw new Error(`Could not load the sources (${res.status})`);
      items = (await res.json()).items as ExtractionItem[];
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
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
      {#if loading}<Spinner label="Loading sources" />{/if}
    </div>
  {/if}

  {#if open}
    <div class="flex flex-col gap-2 pl-1">
      {#if loadError}
        <p class="text-error-400 text-xs">{loadError} <a href={href} class="underline">Open the detail page</a></p>
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
