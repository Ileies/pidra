<script lang="ts">
  // `/runs`: run history with duration and cost trends (Sparkline) and an expandable per-attempt
  // error log per row. Data from `+page.server.ts` (online-only); each row links to `/runs/[id]`.
  // "Mark reviewed" is the `reviewRun` form action. Cost via `$lib/pricing.ts`.
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import Sparkline from "#lib/components/Sparkline.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { enhance } from "$app/forms";
  import Spinner from "#lib/components/Spinner.svelte";
  import { toasts } from "#lib/toast.svelte.js";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { fmtCost, fmtDate, fmtDuration, fmtNum, fmtTime } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
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

  let expanded = $state<Record<string, boolean>>({});
  let reviewing = $state<string | null>(null);

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
      <Card class="px-4 py-3 flex flex-col gap-2">
        <span class="text-xs text-surface-400">Duration, minutes</span>
        <Sparkline
          points={durationSeries}
          max={durationMax}
          width={260}
          height={44}
          label="Run duration in minutes"
          tone={() => "var(--color-primary-400)"}
        />
      </Card>
      {#if PRICING_CONFIGURED}
        <Card class="px-4 py-3 flex flex-col gap-2">
          <span class="text-xs text-surface-400">Cost per run, USD</span>
          <Sparkline
            points={costSeries}
            max={costMax}
            width={260}
            height={44}
            label="Cost per run in USD"
            tone={() => "var(--color-success-500)"}
          />
        </Card>
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
        <Card as="li">
          <div class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1 flex flex-col gap-1.5">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a href="/{run.runDate}" class="text-sm font-medium text-surface-100 no-underline hover:text-primary-400 tabular-nums">
                  {fmtDate(run.runDate)}
                </a>
                <Badge tone={toneFor(run.status)}>
                  {displayLabel(run.status)}
                </Badge>
                {#if run.stepErrors.length > 0 && (failed || degraded)}
                  <button
                    type="button"
                    aria-expanded={open}
                    onclick={() => (expanded[run.id] = !open)}
                    class="py-1 -my-1 text-xs underline underline-offset-2 {degraded ? 'text-warning-400' : 'text-error-400 font-mono'}"
                  >
                    {#if degraded}
                      {run.stepErrors.length} source{run.stepErrors.length === 1 ? "" : "s"} failed
                    {:else}
                      {run.failedStep ?? `${run.stepErrors.length} attempt${run.stepErrors.length === 1 ? "" : "s"}`}
                    {/if}
                  </button>
                {:else if failed && run.failedStep}
                  <span class="text-xs text-error-400 font-mono">{run.failedStep}</span>
                {/if}
                {#if run.unreviewed}
                  <form
                    method="POST"
                    action="?/reviewRun"
                    use:enhance={() => {
                      reviewing = run.id;
                      return async ({ result, update }) => {
                        reviewing = null;
                        if (result.type === "success") toasts.success("Run issue marked as reviewed.");
                        else if (result.type === "failure") toasts.error(String(result.data?.error ?? "That did not go through."));
                        await update({ reset: false });
                      };
                    }}
                  >
                    <input type="hidden" name="id" value={run.id} />
                    <button
                      type="submit"
                      disabled={reviewing !== null}
                      class="btn btn-ghost px-2 py-0.5 text-xs"
                    >
                      {#if reviewing === run.id}<Spinner label="Marking as reviewed" />{/if}
                      Mark reviewed
                    </button>
                  </form>
                {/if}
              </div>

              <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-surface-400 tabular-nums">
                <span>{fmtDuration(run.durationMs)}</span>
                {#if run.startedAt}
                  <span><span class="hidden sm:inline">started </span>{fmtTime(run.startedAt, false)}</span>
                {/if}
                {#if run.itemsIncluded != null}
                  <span>{run.itemsIncluded} items</span>
                {/if}
                {#if PRICING_CONFIGURED && run.tokensIn != null}
                  <span>{runCost(run)}</span>
                {/if}
              </div>
            </div>

            <a
              href="/runs/{run.id}"
              aria-label="Breakdown for {fmtDate(run.runDate)}"
              class="tap shrink-0 inline-flex items-center justify-center gap-1 whitespace-nowrap px-2 sm:pl-3 py-1 rounded text-xs border border-surface-500 text-surface-300 no-underline hover:bg-surface-800"
            >
              <span class="hidden sm:inline">Breakdown</span>
              <ChevronRight class="size-4" aria-hidden="true" />
            </a>
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
        </Card>
      {/each}
    </ul>
  {/if}
</Page>
