<script lang="ts">
  import { setPageContext } from "$lib/assistant/state.svelte";
  import { focusFrom } from "$lib/assistant/pageContext";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import ConfirmButton from "$lib/components/ConfirmButton.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import Sparkline from "$lib/components/Sparkline.svelte";
  import type { Column } from "$lib/components/table";
  import { fmtPct, fmtScore } from "$lib/format";
  import { label as displayLabel, TREND_GLYPH } from "$lib/labels";
  import type { SourceRow } from "./+page.server";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

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

  function scoreTone(score: number | null): string {
    if (score == null) return "text-surface-400";
    if (score >= 7.5) return "text-success-500";
    if (score >= 5) return "text-warning-500";
    return "text-error-500";
  }

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
    <a
      href="/sources/{encodeURIComponent(source.sourceName)}"
      class="text-surface-100 no-underline hover:text-primary-400 hover:underline transition-colors"
    >{source.sourceName}</a>
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

{#snippet trendCell(source: SourceRow)}
  <!-- The glyph never travels alone: an arrow on its own is colour-and-shape only (P7). -->
  <span class="whitespace-nowrap text-surface-300">
    <span aria-hidden="true">{TREND_GLYPH[source.qualityTrend ?? "stable"] ?? "→"}</span>
    {displayLabel(source.qualityTrend ?? "stable")}
  </span>
{/snippet}

{#snippet actionCell(source: SourceRow)}
  {#if source.isActive}
    <ConfirmButton
      label="Disable"
      confirmLabel="Disable"
      action="?/toggle"
      fields={{ sourceName: source.sourceName, isActive: "false" }}
      reasonName="reason"
    />
  {:else}
    <ConfirmButton
      label="Enable"
      action="?/toggle"
      fields={{ sourceName: source.sourceName, isActive: "true" }}
      tone="success"
      immediate
    />
  {/if}
{/snippet}

<Page title="Sources" size="app" class="flex flex-col gap-4">
  <p class="text-xs text-surface-400 leading-relaxed max-w-prose">
    Score 0-10, a weighted average over the last 30 days: relevance x 7 + include rate x 3.
    Disabling a source excludes it from extraction from the next pipeline run on. The name links
    to every delivery the source made, which is where the score comes from.
  </p>

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
      { key: "trend", header: "Trend", showAt: "sm", card: "row", cell: trendCell },
      { key: "action", header: "", width: "w-56", align: "right", card: "actions", cell: actionCell },
    ] as Column<SourceRow>[]}
  />
</Page>
