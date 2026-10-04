<script lang="ts">
  /**
   * One extraction, as a card. Used by the deep-link page and by the report's inline expansion
   * (C5), so the two show the same thing.
   */
  import Badge from "#lib/components/Badge.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { fmtDateTime } from "#lib/format.js";
  import { netJson } from "#lib/offline/net.js";
  import { offline } from "#lib/offline/state.svelte.js";
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

  /** A news desk story: its source is a desk, its date is the event's, its evidence is links. */
  const news = $derived(item.sourceType === "web_news");

  /** The pipeline stores http(s) only; checked again here rather than trusted, like all model output. */
  const safeHref = (url: string) => /^https?:\/\//i.test(url);

  // The stored body never rides along with the extraction (not in the mirror, not in the live
  // read), so it is fetched on request and lives only in this component's state.
  let body = $state<string | null>(null);
  let fetching = $state(false);
  let fetchError = $state<string | null>(null);

  async function fetchBody() {
    fetching = true;
    fetchError = null;
    try {
      const res = await netJson<{ rawContent: string | null }>(`/api/extractions/${encodeURIComponent(item.id)}/raw`);
      if (res.rawContent) body = res.rawContent;
      else fetchError = "No stored content for this item.";
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "Could not fetch the contents.";
    } finally {
      fetching = false;
    }
  }
</script>

<article
  class="bg-surface-900 border border-surface-700 rounded-lg flex flex-col gap-2
    {compact ? 'px-3 py-3' : 'px-4 sm:px-6 py-5 gap-2.5'}"
>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <!-- A desk's source name is "news:world"; a newsletter's or a sender's is shown as it is,
         since `label()` would capitalise an address. -->
    <Badge tone="primary">{news ? displayLabel(item.sourceName) : (item.sourceName ?? item.sourceType)}</Badge>
    {#if item.novelty}
      <Badge tone={NOVELTY_TONE[item.novelty as keyof typeof NOVELTY_TONE] ?? "muted"}>
        {displayLabel(item.novelty)}
      </Badge>
    {/if}
    {#if news && item.extracted?.confidence && item.extracted.confidence !== "confirmed"}
      <Badge tone="warning">{displayLabel(item.extracted.confidence)}</Badge>
    {/if}
    {#if item.extracted?.urgency}
      <span class="font-semibold text-xs uppercase tracking-wider {URGENCY_CLASS[item.extracted.urgency] ?? 'text-surface-300'}">
        {displayLabel(item.extracted.urgency)}
      </span>
    {/if}
    <!-- For a story, when it happened; the scan that found it is the same for every story of the
         morning and says nothing. -->
    <span class="text-surface-400 sm:ml-auto">
      {news && item.extracted?.happened_at ? fmtDateTime(item.extracted.happened_at) : fmtDateTime(item.receivedAt)}
    </span>
    {#if news && item.extracted?.significance != null}
      <span class="text-surface-400 tabular-nums">Significance {item.extracted.significance}</span>
    {:else if item.effectiveRelevance != null}
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
    {:else if news}
      <p class="text-xs text-surface-400">Found by web search - every source below was among the results it returned</p>
    {/if}
  {/if}

  {#if item.extracted?.headline}
    <h3 class="text-{compact ? 'sm' : 'base'} font-semibold text-surface-50 leading-snug">{item.extracted.headline}</h3>
  {/if}

  {#if item.extracted?.key_claim}
    <p class="text-surface-200 text-sm leading-relaxed">{item.extracted.key_claim}</p>
  {/if}

  {#if news && item.extracted?.context}
    <p class="text-surface-300 text-xs leading-relaxed">{item.extracted.context}</p>
  {/if}

  {#if news && item.extracted?.sources?.length}
    <ul class="flex flex-col gap-1 text-xs">
      {#each item.extracted.sources.filter((s) => safeHref(s.url)) as source (source.url)}
        <li class="min-w-0">
          <a href={source.url} target="_blank" rel="noopener noreferrer" class="text-primary-400 hover:text-primary-300 break-words">
            <span class="font-medium">{source.publisher}</span>{source.title ? ` - ${source.title}` : ""}
          </a>
        </li>
      {/each}
    </ul>
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

  <!-- A desk delivery is one shared record for every story of the day, not a message. -->
  {#if !compact && !news}
    <div class="mt-1 flex flex-col gap-2">
      {#if body === null}
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="tap inline-flex items-center gap-2 px-3 py-1.5 bg-surface-800 border border-surface-600 text-surface-200 rounded-md text-xs cursor-pointer hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={fetching || offline.reachable === "offline"}
            onclick={fetchBody}
          >
            {#if fetching}<Spinner label="Fetching" />{/if}
            {fetching ? "Fetching…" : "Fetch contents"}
          </button>
          {#if offline.reachable === "offline"}
            <span class="text-xs text-surface-400">Needs the connection.</span>
          {:else if fetchError}
            <span class="text-xs text-error-400">{fetchError}</span>
          {:else}
            <span class="text-xs text-surface-400">Read once, not saved on this device.</span>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class="tap self-start text-xs text-surface-400 cursor-pointer hover:text-surface-200"
          onclick={() => (body = null)}
        >
          Hide contents
        </button>
        <pre class="text-xs whitespace-pre-wrap break-words text-surface-300 max-h-[32rem] overflow-y-auto bg-surface-950 border border-surface-700 rounded px-4 py-3 leading-relaxed">{body}</pre>
      {/if}
    </div>
  {/if}
</article>
