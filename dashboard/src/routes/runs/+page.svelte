<script lang="ts">
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import Sparkline from "#lib/components/Sparkline.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { fmtCost, fmtDate, fmtDuration, fmtNum, fmtTime } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
  import type { RunRow } from "./+page.server";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /** Completed, but a source dropped out. Counted here rather than server-side: `stepErrors` is
      already on every row, and the summary query has no business learning a second failure mode. */
  const degradedCount = $derived(
    data.runs.filter((run) => run.status === "completed" && run.stepErrors.length > 0).length,
  );

  $effect(() => {
    setPageContext({
      surface: "global",
      route: "/runs",
      digest:
        `Pipeline run history: ${data.summary.total} runs, ${data.summary.failed} failed, ` +
        `${data.summary.running} still running, ${degradedCount} completed with a source missing.`,
    });
  });

  const STATUS_TONE = {
    completed: "success",
    failed: "error",
    running: "primary",
  } as const;

  let expanded = $state<Record<string, boolean>>({});

  /** Oldest first, so both trends read left to right like time does. */
  const chronological = $derived([...data.runs].reverse());

  const durationSeries = $derived(
    chronological
      .filter((run) => run.status === "completed")
      .map((run) => ({ at: run.runDate, value: run.durationMs != null ? run.durationMs / 60000 : null })),
  );

  const durationMax = $derived(
    Math.max(10, ...durationSeries.map((point) => point.value ?? 0).map((value) => Math.ceil(value))),
  );

  const costSeries = $derived(
    chronological.map((run) => ({ at: run.runDate, value: costUsd(run.tokensIn, run.tokensOut) })),
  );

  const costMax = $derived(Math.max(0.01, ...costSeries.map((point) => point.value ?? 0)));

  const totalCost = $derived(
    PRICING_CONFIGURED
      ? data.runs.reduce((sum, run) => sum + (costUsd(run.tokensIn, run.tokensOut) ?? 0), 0)
      : null,
  );

  function runCost(run: RunRow): string {
    return fmtCost(costUsd(run.tokensIn, run.tokensOut));
  }
</script>

<Page title="Runs" size="app" class="flex flex-col gap-5">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Pipeline runs</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      Every run in <code>pipeline_runs</code>. A failed run's attempt log is the same one the
      report page shows, so a failure can be read here without going hunting for the day it
      happened on.
    </p>
  </div>

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <StatCard label="Runs" value={fmtNum(data.summary.total)} hint="Most recent 90" />
    <StatCard label="Failed" value={fmtNum(data.summary.failed)} tone={data.summary.failed > 0 ? "error" : "default"} />
    <StatCard label="Median duration" value={fmtDuration(data.summary.medianDurationMs)} hint="Completed runs only" />
    <StatCard
      label="Cost"
      value={totalCost != null ? fmtCost(totalCost) : "-"}
      hint={PRICING_CONFIGURED ? "Across these runs" : PRICING_HINT}
    />
  </div>

  {#if durationSeries.length > 1}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-3 flex flex-col gap-2">
        <span class="text-xs text-surface-400">Duration, minutes</span>
        <Sparkline
          points={durationSeries}
          max={durationMax}
          width={260}
          height={44}
          label="Run duration in minutes"
          tone={() => "var(--color-primary-400)"}
        />
      </div>
      {#if PRICING_CONFIGURED}
        <div class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-3 flex flex-col gap-2">
          <span class="text-xs text-surface-400">Cost per run, USD</span>
          <Sparkline
            points={costSeries}
            max={costMax}
            width={260}
            height={44}
            label="Cost per run in USD"
            tone={() => "var(--color-success-500)"}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if data.runs.length === 0}
    <EmptyState title="No pipeline runs recorded yet." hint="A run appears here the moment run.ts inserts its row, before it finishes." />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.runs as run (run.id)}
        {@const open = !!expanded[run.id]}
        {@const failed = run.status === "failed"}
        <!-- A completed run carries `step_errors` when a source dropped out but the briefing was
             still written. The row used to gate the whole disclosure on `failed`, so those were
             stored and never rendered: a green badge and no way to find out Calendar had been
             dead for a week. -->
        {@const degraded = !failed && run.stepErrors.length > 0}
        <li class="rounded-lg border border-surface-700 bg-surface-900">
          <div class="flex flex-wrap items-center gap-3 px-4 py-3">
            <a href="/{run.runDate}" class="text-sm font-medium text-surface-100 no-underline hover:text-primary-400 tabular-nums">
              {fmtDate(run.runDate)}
            </a>
            <Badge tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? "muted"}>
              {displayLabel(run.status)}
            </Badge>
            {#if failed && run.failedStep}
              <span class="text-xs text-error-400 font-mono">{run.failedStep}</span>
            {:else if degraded}
              <span class="text-xs text-warning-400">{run.stepErrors.length} source{run.stepErrors.length === 1 ? "" : "s"} failed</span>
            {/if}
            <span class="text-xs text-surface-400 tabular-nums">{fmtDuration(run.durationMs)}</span>
            {#if run.startedAt}
              <span class="text-xs text-surface-400 tabular-nums hidden sm:inline">started {fmtTime(run.startedAt, false)}</span>
            {/if}
            {#if run.itemsIncluded != null}
              <span class="text-xs text-surface-400 tabular-nums hidden md:inline">{run.itemsIncluded} items</span>
            {/if}
            {#if PRICING_CONFIGURED && run.tokensIn != null}
              <span class="text-xs text-surface-400 tabular-nums">{runCost(run)}</span>
            {/if}

            {#if run.stepErrors.length > 0 && (failed || degraded)}
              <button
                type="button"
                aria-expanded={open}
                onclick={() => (expanded[run.id] = !open)}
                class="tap ml-auto px-3 py-1 rounded text-xs border border-surface-500 text-surface-300 hover:bg-surface-800 cursor-pointer"
              >
                {open ? "Hide" : "Show"}
                {run.stepErrors.length}
                {#if degraded}failure{run.stepErrors.length === 1 ? "" : "s"}{:else}attempt{run.stepErrors.length === 1 ? "" : "s"}{/if}
              </button>
            {/if}
          </div>

          {#if open}
            <div class="px-4 pb-4">
              <ErrorCard
                step={run.failedStep}
                durationMs={run.durationMs}
                attempts={run.stepErrors}
                variant={degraded ? "degraded" : "failed"}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Page>
