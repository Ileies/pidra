<script lang="ts">
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import DeliveryCard, { isSkipped } from "./DeliveryCard.svelte";
  import SourceHeader from "./SourceHeader.svelte";
  import { goto } from "$app/navigation";
  import DeleteSourceModal from "#lib/components/DeleteSourceModal.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDate, fmtPct, fmtScore, scoreTone } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

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

{#snippet dayScoreCell(day: DailyScore)}
  <span class="tabular-nums {scoreTone(day.compositeScore)}">{fmtScore(day.compositeScore)}</span>
{/snippet}

<Page title={data.sourceName} size="app" class="flex flex-col gap-6">
  <SourceHeader name={data.sourceName} stats={data.stats} quality={data.quality} />

  <!-- The numbers behind the score, so it is checkable rather than just a verdict. -->
  <section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    {#each stats as [statLabel, value, hint] (statLabel)}
      <StatCard label={statLabel} {value} {hint} />
    {/each}
  </section>

  {#if data.dailyScores.length > 0}
    <details class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3">
      <summary class="tap text-xs text-surface-400 select-none hover:text-surface-200">
        Daily values, last 30 days ({data.dailyScores.length})
      </summary>
      <div class="mt-3">
        <DataTable
          rows={data.dailyScores}
          key={(day) => day.runDate}
          mode="scroll"
          caption="Daily source scores"
          columns={[
            { key: "day", header: "Day", value: (d) => fmtDate(d.runDate), class: "text-surface-200 whitespace-nowrap" },
            { key: "received", header: "Received", align: "right", value: (d) => String(d.itemsReceived), class: "tabular-nums" },
            { key: "included", header: "Included", align: "right", showAt: "sm", value: (d) => String(d.itemsIncluded), class: "tabular-nums" },
            { key: "rate", header: "Rate", align: "right", value: (d) => fmtPct(d.includeRate), class: "tabular-nums" },
            { key: "relevance", header: "Avg relevance", align: "right", showAt: "md", value: (d) => fmtScore(d.avgRelevance, 2), class: "tabular-nums" },
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
      <DeliveryCard {delivery} />
    {/each}

    {#if data.deliveries.length === 0}
      <EmptyState title="Nothing has arrived from this source yet." compact />
    {:else if visible.length === 0}
      <EmptyState title="No delivery matches the filter." compact />
    {/if}
  </section>

  <!-- Destructive and rare, so it lives apart from the page's everyday controls. -->
  <section
    class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-surface-800 pt-4"
  >
    <p class="text-xs text-surface-400">
      Deleting removes this source's scores and settings. Past reports stay as they are.
    </p>
    <div class="shrink-0">
      <DeleteSourceModal
        sourceName={data.sourceName}
        unsubscribeUrl={data.quality?.unsubscribe_url ?? null}
        action="?/delete"
        onDeleted={() => goto("/sources")}
      />
    </div>
  </section>
</Page>
