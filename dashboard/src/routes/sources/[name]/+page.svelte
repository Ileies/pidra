<script lang="ts">
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDate, fmtDateTime, fmtPct, fmtScore } from "#lib/format.js";
  import { label as displayLabel, TREND_GLYPH } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type Delivery = PageData["deliveries"][number];
  type Item = Delivery["items"][number];
  type DailyScore = PageData["dailyScores"][number];

  $effect(() => {
    setPageContext({
      surface: "sources",
      route: `/sources/${encodeURIComponent(data.sourceName)}`,
      digest: `Source detail "${data.sourceName}": ${data.quality?.is_active === false ? "disabled" : "active"}, score ${
        data.quality?.composite_score_30d?.toFixed(1) ?? "-"
      }/10, ${data.stats.items} items from ${data.stats.deliveries} deliveries, ${data.stats.emptyDeliveries} deliveries with no item.`,
      focus: [{ kind: "source", id: data.sourceName }],
    });
  });

  let query = $state("");
  let onlyEmpty = $state(false);

  const isActive = $derived(data.quality?.is_active !== false);

  /** An extraction row without a headline carried no content: skipped, or an empty result. */
  function isSkipped(item: Item): boolean {
    return !item.headline && !item.keyClaim;
  }

  const visible = $derived(
    data.deliveries.filter((delivery) => {
      if (onlyEmpty && delivery.items.some((item) => !isSkipped(item))) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const haystack = [
        delivery.title,
        delivery.sender,
        ...delivery.items.map((item) => `${item.headline ?? ""} ${item.keyClaim ?? ""} ${item.topicTags.join(" ")}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    }),
  );

  function scoreTone(score: number | null | undefined): string {
    if (score == null) return "text-surface-400";
    if (score >= 7.5) return "text-success-500";
    if (score >= 5) return "text-warning-500";
    return "text-error-500";
  }

  function relevanceTone(score: number | null): string {
    if (score == null) return "text-surface-400";
    if (score >= 4) return "text-success-500";
    if (score >= 3) return "text-warning-500";
    return "text-surface-400";
  }

  function itemLabel(item: Item): string {
    if (item.headline) return item.headline;
    if (item.keyClaim) return item.keyClaim;
    if (item.skipReason) return `Skipped: ${displayLabel(item.skipReason)}`;
    return "Skipped - nothing extracted";
  }

  const includeRate = $derived(data.stats.items > 0 ? data.stats.included / data.stats.items : null);

  const stats = $derived([
    ["Include rate", fmtPct(includeRate), `${data.stats.included} of ${data.stats.items} items`],
    ["Avg relevance", fmtScore(data.stats.avgRelevance, 2), "From extraction, 1-5"],
    ["Avg effective", fmtScore(data.stats.avgEffectiveRelevance, 2), "After trust and novelty"],
    ["Skipped", String(data.stats.skipped), "Promotional or empty"],
    ["No extraction", String(data.stats.emptyDeliveries), "Deliveries with no item at all"],
    ["Ratings", `+${data.stats.plus} / −${data.stats.minus}`, "Given by you"],
    ["Extraction errors", String(data.stats.aiFailed), "The AI call failed"],
  ] as [string, string, string][]);
</script>

{#snippet dayCell(day: DailyScore)}
  <span class="text-surface-200 whitespace-nowrap">{fmtDate(day.runDate)}</span>
{/snippet}
{#snippet receivedCell(day: DailyScore)}<span class="tabular-nums">{day.itemsReceived}</span>{/snippet}
{#snippet includedCell(day: DailyScore)}<span class="tabular-nums">{day.itemsIncluded}</span>{/snippet}
{#snippet rateCell(day: DailyScore)}<span class="tabular-nums">{fmtPct(day.includeRate)}</span>{/snippet}
{#snippet relevanceCell(day: DailyScore)}<span class="tabular-nums">{fmtScore(day.avgRelevance, 2)}</span>{/snippet}
{#snippet dayScoreCell(day: DailyScore)}
  <span class="tabular-nums {scoreTone(day.compositeScore)}">{fmtScore(day.compositeScore)}</span>
{/snippet}

<Page title={data.sourceName} size="app" class="flex flex-col gap-6">
  <!-- Header: what the score is, and the one decision this page exists to support. -->
  <section class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
    <div class="flex flex-col gap-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <a href="/sources" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← Sources</a>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <h1 class="text-lg font-semibold text-surface-50 break-words">{data.sourceName}</h1>
        {#if !isActive}<Badge tone="muted">Disabled</Badge>{/if}
      </div>
      <p class="text-xs text-surface-400">
        {data.stats.deliveries} deliveries, {data.stats.items} items
        {#if data.stats.firstSeen}· since {fmtDate(data.stats.firstSeen)}{/if}
        {#if data.stats.lastSeen}· last {fmtDate(data.stats.lastSeen)}{/if}
      </p>
      {#if !isActive && data.quality?.disabled_reason}
        <p class="text-xs text-surface-400">
          Reason: <span class="text-surface-200">{data.quality.disabled_reason}</span>
          {#if data.quality.disabled_at}({fmtDate(data.quality.disabled_at)}){/if}
        </p>
      {/if}
    </div>

    <div class="flex items-center gap-4 shrink-0">
      <div class="text-right">
        <div class="text-2xl font-semibold tabular-nums {scoreTone(data.quality?.composite_score_30d)}">
          {fmtScore(data.quality?.composite_score_30d)}<span class="text-xs text-surface-400 ml-px">/10</span>
        </div>
        <div class="text-xs text-surface-400 whitespace-nowrap">
          <span aria-hidden="true">{TREND_GLYPH[data.quality?.quality_trend ?? "stable"] ?? "→"}</span>
          {displayLabel(data.quality?.quality_trend ?? "stable")}
        </div>
      </div>

      {#if isActive}
        <ConfirmButton label="Disable" confirmLabel="Disable" action="?/toggle" fields={{ isActive: "false" }} reasonName="reason" />
      {:else}
        <ConfirmButton label="Enable" action="?/toggle" fields={{ isActive: "true" }} tone="success" immediate />
      {/if}
    </div>
  </section>

  <!-- The numbers behind the score, so it is checkable rather than just a verdict. -->
  <section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    {#each stats as [statLabel, value, hint] (statLabel)}
      <StatCard label={statLabel} {value} {hint} />
    {/each}
  </section>

  {#if data.dailyScores.length > 0}
    <details class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3">
      <summary class="tap text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">
        Daily values, last 30 days ({data.dailyScores.length})
      </summary>
      <div class="mt-3">
        <DataTable
          rows={data.dailyScores}
          key={(day) => day.runDate}
          mode="scroll"
          caption="Daily source scores"
          columns={[
            { key: "day", header: "Day", cell: dayCell },
            { key: "received", header: "Received", align: "right", cell: receivedCell },
            { key: "included", header: "Included", align: "right", showAt: "sm", cell: includedCell },
            { key: "rate", header: "Rate", align: "right", cell: rateCell },
            { key: "relevance", header: "Avg relevance", align: "right", showAt: "md", cell: relevanceCell },
            { key: "score", header: "Score", align: "right", cell: dayScoreCell },
          ] as Column<DailyScore>[]}
        />
      </div>
    </details>
  {/if}

  <!-- The directory itself: every delivery and what extraction made of it. -->
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-base font-semibold text-surface-50">Deliveries</h2>
      <span class="text-xs text-surface-400">
        {visible.length} of {data.deliveries.length}
        {#if data.stats.deliveries > data.deliveries.length}
          (newest {data.deliveryLimit} of {data.stats.deliveries})
        {/if}
      </span>
      <input
        type="search"
        placeholder="Filter: title, headline, tag…"
        aria-label="Filter deliveries"
        bind:value={query}
        class="input-base w-full sm:w-56 sm:ml-auto"
      />
      <label class="tap-check text-xs text-surface-400">
        <input type="checkbox" bind:checked={onlyEmpty} class="accent-primary-500 h-4 w-4" />
        Only deliveries with no item
      </label>
    </div>

    {#each visible as delivery (delivery.rawItemId)}
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
                      href="/{item.runDate ?? delivery.runDate}/detail/{item.id}"
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
    {/each}

    {#if data.deliveries.length === 0}
      <EmptyState title="Nothing has arrived from this source yet." compact />
    {:else if visible.length === 0}
      <EmptyState title="No delivery matches the filter." compact />
    {/if}
  </section>
</Page>
