<script module lang="ts">
  import type { SourceItem } from "./+page.server";

  /** An extraction row without a headline carried no content: skipped, or an empty result. */
  export function isSkipped(item: SourceItem): boolean {
    return !item.headline && !item.keyClaim;
  }
</script>

<script lang="ts">
  import Badge from "#lib/components/Badge.svelte";
  import { fmtDateTime, fmtScore } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { sourceItemDetailHref } from "#lib/sourceLinks.js";
  import type { Delivery } from "./+page.server";

  let { delivery }: { delivery: Delivery } = $props();

  function relevanceTone(score: number | null): string {
    if (score == null) return "text-surface-400";
    if (score >= 4) return "text-success-500";
    if (score >= 3) return "text-warning-500";
    return "text-surface-400";
  }

  function itemLabel(item: SourceItem): string {
    if (item.headline) return item.headline;
    if (item.keyClaim) return item.keyClaim;
    if (item.skipReason) return `Skipped: ${displayLabel(item.skipReason)}`;
    return "Skipped - nothing extracted";
  }
</script>

<article class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3 flex flex-col gap-2">
  <div class="flex flex-wrap items-baseline gap-2 text-xs">
    <span class="text-surface-200 font-medium flex-1 min-w-0 break-words">{delivery.title ?? "(untitled)"}</span>
    <span class="text-surface-400 whitespace-nowrap">{fmtDateTime(delivery.receivedAt)}</span>
  </div>

  {#if delivery.sender}
    <p class="text-xs text-surface-400 break-all">From: {delivery.sender}</p>
  {/if}

  {#if delivery.items.length === 0}
    <p class="text-xs text-surface-400">
      Nothing extracted - skipped as promotional, automated, or without informational content.
    </p>
  {:else}
    <ul class="flex flex-col divide-y divide-surface-800 border-t border-surface-800 -mx-1">
      {#each delivery.items as item (item.id)}
        {@const skipped = isSkipped(item)}
        <li class="px-1 py-2 flex flex-col gap-1">
          <div class="flex items-start gap-2">
            <span
              class="text-sm font-semibold tabular-nums w-8 shrink-0 text-right
                {skipped ? 'text-surface-400' : relevanceTone(item.effectiveRelevance ?? item.relevanceScore)}"
            >
              {skipped ? "-" : fmtScore(item.effectiveRelevance ?? item.relevanceScore, 1)}
            </span>
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <a
                href={sourceItemDetailHref(item.runDate ?? delivery.runDate, item.id)}
                class="text-sm leading-snug no-underline hover:text-primary-400 transition-colors
                  {skipped ? 'text-surface-400 italic' : 'text-surface-200'}"
              >
                {itemLabel(item)}
              </a>
              <div class="flex flex-wrap items-center gap-1.5">
                {#if item.includedInReport}
                  <Badge tone="success">In report</Badge>
                {:else if !skipped}
                  <Badge tone="muted">Filtered out</Badge>
                {/if}
                {#if item.novelty && item.novelty !== "new"}
                  <Badge tone="warning">{displayLabel(item.novelty)}</Badge>
                {/if}
                {#if item.rating === "explicit_plus"}
                  <Badge tone="success">Rated +</Badge>
                {:else if item.rating === "explicit_minus"}
                  <Badge tone="error">Rated −</Badge>
                {/if}
                {#if item.aiFailed}
                  <Badge tone="error">Extraction failed</Badge>
                {/if}
                {#each item.topicTags as tag (tag)}
                  <Badge tone="neutral">{tag}</Badge>
                {/each}
              </div>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</article>
