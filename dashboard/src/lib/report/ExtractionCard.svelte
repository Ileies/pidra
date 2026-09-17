<script lang="ts">
  /**
   * One extraction, as a card. Used by the deep-link page and by the report's inline expansion
   * (C5), so the two show the same thing.
   */
  import Badge from "#lib/components/Badge.svelte";
  import { fmtDateTime } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import type { ExtractionItem } from "#lib/server/extractions.js";

  interface Props {
    item: ExtractionItem;
    /** Compact form for the inline expansion: no raw email, tighter padding. */
    compact?: boolean;
  }

  let { item, compact = false }: Props = $props();

  const NOVELTY_TONE = {
    new: "success",
    continuation: "warning",
    repeat: "muted",
  } as const;

  const URGENCY_CLASS: Record<string, string> = {
    critical: "text-error-400",
    high: "text-warning-400",
    normal: "text-surface-300",
    low: "text-surface-400",
  };
</script>

<article
  class="bg-surface-900 border border-surface-700 rounded-lg flex flex-col gap-2
    {compact ? 'px-3 py-3' : 'px-4 sm:px-6 py-5 gap-2.5'}"
>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <Badge tone="primary">{item.sourceName ?? item.sourceType}</Badge>
    {#if item.novelty}
      <Badge tone={NOVELTY_TONE[item.novelty as keyof typeof NOVELTY_TONE] ?? "muted"}>
        {displayLabel(item.novelty)}
      </Badge>
    {/if}
    {#if item.extracted?.urgency}
      <span class="font-semibold text-xs uppercase tracking-wider {URGENCY_CLASS[item.extracted.urgency] ?? 'text-surface-300'}">
        {displayLabel(item.extracted.urgency)}
      </span>
    {/if}
    <span class="text-surface-400 sm:ml-auto">{fmtDateTime(item.receivedAt)}</span>
    {#if item.effectiveRelevance != null}
      <span class="text-surface-400 tabular-nums">Relevance {item.effectiveRelevance.toFixed(1)}</span>
    {/if}
  </div>

  {#if !compact}
    {#if item.sender || item.receiver}
      <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        {#if item.sender}
          <dt class="text-surface-400">From:</dt>
          <dd class="text-surface-200 break-all">{item.sender}</dd>
        {/if}
        {#if item.receiver}
          <dt class="text-surface-400">To:</dt>
          <dd class="text-surface-200 break-all">{item.receiver}</dd>
        {/if}
      </dl>
    {:else if item.sourceType === "newsletter"}
      <p class="text-xs text-surface-400">Via RSS feed - no sender or recipient</p>
    {/if}
  {/if}

  {#if item.extracted?.headline}
    <h3 class="text-{compact ? 'sm' : 'base'} font-semibold text-surface-50 leading-snug">{item.extracted.headline}</h3>
  {/if}

  {#if item.extracted?.key_claim}
    <p class="text-surface-200 text-sm leading-relaxed">{item.extracted.key_claim}</p>
  {/if}

  {#if item.extracted?.action_required}
    <p class="text-sm text-surface-200"><strong class="text-surface-50">Action:</strong> {item.extracted.action_required}</p>
  {/if}

  {#if item.extracted?.deadline}
    <p class="text-sm text-surface-200"><strong class="text-surface-50">Deadline:</strong> {item.extracted.deadline}</p>
  {/if}

  {#if item.extracted?.topic_tags?.length}
    <div class="flex flex-wrap gap-1.5">
      {#each item.extracted.topic_tags as tag (tag)}
        <Badge tone="neutral">{tag}</Badge>
      {/each}
    </div>
  {/if}

  {#if item.extracted?.entities?.length}
    <div class="flex flex-wrap gap-1.5">
      {#each item.extracted.entities as entity (entity)}
        <Badge tone="muted">{entity}</Badge>
      {/each}
    </div>
  {/if}

  {#if !compact && item.rawContent}
    <details class="mt-1">
      <summary class="tap text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">Show the original email</summary>
      <pre class="mt-3 text-xs whitespace-pre-wrap break-words text-surface-300 max-h-96 overflow-y-auto bg-surface-950 border border-surface-700 rounded px-4 py-3 leading-relaxed">{item.rawContent}</pre>
    </details>
  {/if}
</article>
