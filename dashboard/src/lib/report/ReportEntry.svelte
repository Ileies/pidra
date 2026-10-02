<script lang="ts">
  /**
   * One entry of the briefing: the prose and the expansion, which holds the rating controls (C4, C5).
   *
   * Tapping an entry expands its extraction cards in place; it used to navigate to
   * `/[date]/detail/[ids]`, which lost the reader's place in a report several screens long. The
   * chevron beside the prose says the entry opens; the deep link stays as the shareable form,
   * offered inside the expansion.
   *
   * The cards come from the mirror, which holds every extraction a mirrored
   * report cites, so they open in the same frame online or not. This used to be a request per
   * tap, which offline meant a spinner and then an error under a report that was otherwise fine.
   */
  import { extractionsFor, type MirroredExtraction } from "#lib/offline/repo.js";
  import ExtractionCard from "#lib/report/ExtractionCard.svelte";
  import { markEntryHintSeen } from "#lib/report/entry-hint.svelte.js";
  import QuickActions from "#lib/report/QuickActions.svelte";
  import RateButtons from "#lib/report/RateButtons.svelte";
  import type { QuickAction } from "#lib/report/types.js";
  import type { RenderedEntry } from "#lib/server/reports.js";

  interface Props {
    entry: RenderedEntry;
    date: string;
    ratings: Record<string, string | null>;
    onRate: (extractionId: string, eventType: string | null) => void;
    /** A left accent bar, for the urgency groups in Section 2. */
    accent?: string;
    /** The quick actions for the mails this entry cites. The page assigns each to one entry. */
    actions?: QuickAction[];
  }

  let { entry, date, ratings, onRate, accent, actions = [] }: Props = $props();

  let open = $state(false);
  let items = $state<MirroredExtraction[] | null>(null);

  const href = $derived(`/${date}/detail/${entry.refIds.join(",")}`);
  const missing = $derived(items ? entry.refIds.length - items.length : 0);

  const expandable = $derived(entry.refIds.length > 0);

  async function toggle() {
    open = !open;
    if (open) markEntryHintSeen();
    // Read on every open rather than once: a rating given since, or a sync, is in the mirror.
    if (open) items = await extractionsFor(null, entry.refIds);
  }

  /** A tap anywhere on the entry opens it, except where the tap meant something else: a link in
   *  the prose, a rating button, or the end of a text selection (a drag to copy must not toggle). */
  function onSurfaceClick(event: MouseEvent) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest("a, button")) return;
    if (!window.getSelection()?.isCollapsed) return;
    void toggle();
  }

  function onSurfaceKeydown(event: KeyboardEvent) {
    // Only when the entry itself has focus; Enter on a link or button inside keeps its own meaning.
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void toggle();
  }
</script>

<div class="group flex flex-col gap-2 {accent ? `border-l-2 pl-3 ${accent}` : ''}">
  <!-- The entry is the control: there is no button to find or to miss with a thumb. A chevron
       at the end of the prose (`.entry-prose` in app.css) says it opens, the tint says it is
       pressable, and the hint above the report says it once. `role="group"` rather than "button"
       because the prose holds links, which a button would hide from a screen reader. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    data-expandable={expandable ? "" : undefined}
    tabindex={expandable ? 0 : undefined}
    onclick={expandable ? onSurfaceClick : undefined}
    onkeydown={expandable ? onSurfaceKeydown : undefined}
    class="flex items-start gap-3 {expandable
      ? '-mx-2 -my-1 px-2 py-1 rounded-md cursor-pointer transition-colors outline-none [-webkit-tap-highlight-color:transparent] hover:bg-surface-900 active:bg-surface-800 focus-visible:ring-2 focus-visible:ring-primary-500'
      : ''}"
  >
    <div class="report-body min-w-0 flex-1 text-sm {expandable ? 'entry-prose' : ''}" data-open={open ? '' : undefined}>
      {@html entry.html}
    </div>

    {#if expandable}
      <span class="sr-only">{open ? "Details shown. Press Enter to hide." : "Press Enter for details."}</span>
    {/if}
  </div>

  <QuickActions {actions} />

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
      <div class="flex items-center justify-between gap-3">
        {#if items}
          <a href={href} class="text-xs text-surface-400 hover:text-surface-200">Open the full detail page →</a>
        {:else}
          <span></span>
        {/if}
        <RateButtons
          extractionId={entry.refIds[0]}
          rating={ratings[entry.refIds[0]] ?? null}
          {onRate}
        />
      </div>
    </div>
  {/if}
</div>
