<script lang="ts">
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import Sparkline from "#lib/components/Sparkline.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDate, fmtPct, fmtScore, scoreTone } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { SourceRow } from "./+page.server";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  // Sources are keyed by name, not by id, so that is what the focus list carries.
  $effect(() => {
    setPageContext({
      surface: "sources",
      route: "/sources",
      digest: `Source dashboard: ${data.sources.length} sources, ${data.sources.filter((source) => !source.isActive).length} disabled.`,
      focus: focusFrom(data.sources, "source", (source) => ({
        id: source.sourceName,
        label: `${source.isActive ? "active" : "disabled"}, score ${source.compositeScore30d?.toFixed(1) ?? "-"}`,
      })),
    });
  });

  function includeRate(source: SourceRow): number | null {
    if (source.dailyScores.length === 0) return null;
    return source.dailyScores.reduce((sum, day) => sum + (day.includeRate ?? 0), 0) / source.dailyScores.length;
  }

  /** Oldest first, so the sparkline reads left to right like time does. */
  function series(source: SourceRow) {
    return source.dailyScores
      .slice()
      .reverse()
      .map((day) => ({ at: day.runDate, value: day.compositeScore }));
  }
</script>

{#snippet nameCell(source: SourceRow)}
  <span class="inline-flex items-center gap-2 flex-wrap">
    <span class="text-surface-100">{source.sourceName}</span>
    {#if !source.isActive}
      <Badge tone="muted">Disabled</Badge>
    {/if}
  </span>
{/snippet}

{#snippet scoreCell(source: SourceRow)}
  <span class="text-base font-semibold tabular-nums {scoreTone(source.compositeScore30d)}">
    {fmtScore(source.compositeScore30d)}<span class="text-xs text-surface-400 ml-px">/10</span>
  </span>
{/snippet}

{#snippet historyCell(source: SourceRow)}
  <Sparkline points={series(source)} label="Composite score, last 30 days" />
{/snippet}

{#snippet rateCell(source: SourceRow)}
  <span class="tabular-nums">{fmtPct(includeRate(source))}</span>
{/snippet}

{#snippet lastDeliveryCell(source: SourceRow)}
  <span class="whitespace-nowrap text-surface-300">{fmtDate(source.lastDelivery)}</span>
{/snippet}

{#snippet actionCell(source: SourceRow)}
  <span class="inline-flex items-center gap-2">
    {#if !source.isActive}
      <ConfirmButton
        label="Enable"
        action="?/toggle"
        fields={{ sourceName: source.sourceName, isActive: "true" }}
        tone="success"
        immediate
      />
    {/if}
    <a
      href="/sources/{encodeURIComponent(source.sourceName)}"
      class="btn btn-sm btn-ghost"
    >
      Details
    </a>
  </span>
{/snippet}

<Page title="Sources" size="app" class="flex flex-col gap-4">
  <DataTable
    rows={data.sources}
    key={(source) => source.sourceName}
    dim={(source) => !source.isActive}
    mode="cards"
    caption="Source quality"
    emptyTitle="No source data yet."
    emptyHint="Sources appear here after the first pipeline run."
    columns={[
      { key: "name", header: "Newsletter", card: "title", cell: nameCell },
      { key: "score", header: "Score 30d", align: "right", card: "row", cell: scoreCell },
      { key: "history", header: "History", width: "w-40", showAt: "md", card: "row", cell: historyCell },
      { key: "rate", header: "Include rate", align: "right", card: "row", cell: rateCell },
      { key: "lastDelivery", header: "Last delivery", showAt: "sm", card: "row", cell: lastDeliveryCell },
      { key: "action", header: "", width: "w-56", align: "right", card: "actions", cell: actionCell },
    ] as Column<SourceRow>[]}
  />
</Page>
