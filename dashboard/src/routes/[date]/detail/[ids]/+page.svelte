<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { fmtDateTime } from "$lib/format";
  import { label as displayLabel } from "$lib/labels";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Still the report surface: these are the items behind a briefing paragraph, so they are read
  // material too. What the assistant can change from here are notes, todos and the context.
  $effect(() => {
    setPageContext({
      surface: "report",
      route: `/${data.date}/detail/${data.ids}`,
      digest: `Detail view for the ${data.date} briefing: ${data.items.length} item(s) from ${
        [...new Set(data.items.map((item) => item.sourceName).filter(Boolean))].join(", ") || "an unknown source"
      }.`,
    });
  });

  let loading = $state(false);

  // Track optimistic rating state per item. Re-synced whenever the load function returns fresh
  // rows, so the server value wins once a rating round-trip has completed.
  let ratings = $state<Record<string, string | null>>({});
  $effect(() => {
    ratings = Object.fromEntries(data.items.map((item) => [item.id, item.rating ?? null]));
  });

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

  /** [signal, glyph, accessible name, tone] */
  const RATINGS = [
    ["1", "+", "Relevant - this was worth reading", "success"],
    ["-1", "−", "Not relevant", "error"],
  ] as const;
</script>

<Page title="Detail {data.date}" size="read" class="flex flex-col gap-8">
  <a href="/{data.date}" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← {data.date}</a>

  <div class="flex flex-col gap-5">
    {#each data.items as item (item.id)}
      <article class="bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-6 py-5 flex flex-col gap-2.5">
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

        {#if item.extracted?.headline}
          <h2 class="text-base font-semibold text-surface-50 leading-snug">{item.extracted.headline}</h2>
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

        {#if item.rawContent}
          <details class="mt-1">
            <summary class="tap text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">Show the original email</summary>
            <pre class="mt-3 text-xs whitespace-pre-wrap break-words text-surface-300 max-h-96 overflow-y-auto bg-surface-950 border border-surface-700 rounded px-4 py-3 leading-relaxed">{item.rawContent}</pre>
          </details>
        {/if}

        <div class="flex items-center gap-2 pt-2 border-t border-surface-800 mt-1">
          <span class="text-xs text-surface-400">Relevance signal:</span>
          {#each RATINGS as [signal, glyph, name, tone] (signal)}
            {@const event = signal === "1" ? "explicit_plus" : "explicit_minus"}
            <form
              method="POST"
              action="?/rate"
              use:enhance={({ formData }) => {
                const id = formData.get("extraction_id") as string;
                const sig = formData.get("signal") as string;
                const et = sig === "1" ? "explicit_plus" : "explicit_minus";
                ratings[id] = ratings[id] === et ? null : et;
                return async ({ update }) => update({ reset: false });
              }}
            >
              <input type="hidden" name="extraction_id" value={item.id} />
              <input type="hidden" name="signal" value={signal} />
              <!-- 44px, and with a real accessible name: `+` and `−` alone are not labels (X4). -->
              <button
                type="submit"
                aria-pressed={ratings[item.id] === event}
                class="h-11 w-11 sm:h-9 sm:w-9 rounded text-base font-bold transition-colors border cursor-pointer
                  {ratings[item.id] === event
                    ? tone === 'success'
                      ? 'bg-success-700 border-success-500 text-success-50'
                      : 'bg-error-700 border-error-500 text-error-50'
                    : 'bg-surface-800 border-surface-500 text-surface-300 hover:border-surface-400'}"
              >
                <span aria-hidden="true">{glyph}</span>
                <span class="sr-only">{name}</span>
              </button>
            </form>
          {/each}
        </div>
      </article>
    {/each}
  </div>

  <section class="border-t border-surface-700 pt-6 flex flex-col gap-3">
    <h2 class="text-base font-semibold text-surface-50">Go deeper</h2>
    <p class="text-sm text-surface-300">
      Fetches fresh web results and writes a personalised analysis, without repeating what the
      report already said.
    </p>

    <form
      method="POST"
      action="?/zusammenfassen"
      use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          await update();
          loading = false;
        };
      }}
    >
      <button
        type="submit"
        class="tap inline-flex items-center gap-2 px-5 py-2 bg-primary-900 border border-primary-600 text-primary-200 rounded-md text-sm cursor-pointer hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={loading}
      >
        {#if loading}<Spinner label="Analysing" />{/if}
        {loading ? "Analysing…" : "Summarise and go deeper"}
      </button>
    </form>

    {#if form?.error}
      <p class="text-error-400 text-sm">{form.error}</p>
    {/if}

    {#if form?.deepDiveHtml}
      <div class="report-body mt-2 bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-6 py-5">
        {@html form.deepDiveHtml}
      </div>
    {/if}
  </section>
</Page>
