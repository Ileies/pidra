<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import Page from "$lib/components/Page.svelte";
  import StatBar from "$lib/components/StatBar.svelte";
  import ErrorCard from "$lib/components/ErrorCard.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { fmtCost, fmtDate, fmtNum } from "$lib/format";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "$lib/pricing";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The report surface: the assistant can read this briefing and act on notes, todos, the
  // calendar or the long-term context, but never edit the report. Reports are final.
  $effect(() => {
    setPageContext({
      surface: "report",
      route: `/${data.date}`,
      digest: [
        `Daily briefing for ${data.date}${data.date === data.today ? " (today)" : ""}.`,
        data.report
          ? `${data.report.itemsIncluded ?? 0} of ${data.report.itemCount ?? 0} items in the report, ${data.report.itemsFiltered ?? 0} filtered out.`
          : "There is no report for this day yet.",
        data.pipelineRun ? `Last run: ${data.pipelineRun.status}.` : "",
      ].filter(Boolean).join(" "),
    });
  });

  let triggering = $state(false);

  const cost = $derived(costUsd(data.report?.tokensIn, data.report?.tokensOut));

  const stats = $derived(
    data.report
      ? [
          { label: "ingested", value: fmtNum(data.report.itemCount) },
          { label: "included", value: fmtNum(data.report.itemsIncluded) },
          {
            label: "tokens in",
            value: fmtNum(data.report.tokensIn),
            title: PRICING_CONFIGURED ? `Run cost: ${fmtCost(cost)}` : PRICING_HINT,
          },
          {
            label: "tokens out",
            value: fmtNum(data.report.tokensOut),
            title: PRICING_CONFIGURED ? `Run cost: ${fmtCost(cost)}` : PRICING_HINT,
          },
          ...(data.report.aiCalls != null ? [{ label: "AI calls", value: fmtNum(data.report.aiCalls) }] : []),
          ...(data.report.webSearchesRun ? [{ label: "web searches", value: fmtNum(data.report.webSearchesRun) }] : []),
          ...(cost != null ? [{ label: "cost", value: fmtCost(cost) }] : []),
        ]
      : [],
  );
</script>

{#snippet statsBar()}
  {#if data.report}
    <StatBar {stats} />
  {/if}
{/snippet}

<Page title={data.date} size="read" bleed={statsBar} class="flex flex-col gap-6">
  <!-- The day steppers live here rather than in the navbar (M-1): they are only ever on this
       route, and two large targets beside the date beat two 22px pills in a wrapped header. -->
  <nav class="flex items-center justify-between gap-3" aria-label="Day">
    {#if data.prevDate}
      <a href="/{data.prevDate}" class="tap flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-700 bg-surface-900 text-sm text-surface-200 no-underline hover:bg-surface-800">
        <span aria-hidden="true">←</span>
        <span class="hidden xs:inline">{data.prevDate}</span>
        <span class="sr-only">Previous day, {data.prevDate}</span>
      </a>
    {:else}
      <span class="tap flex items-center px-3 py-2 rounded-lg border border-surface-800 text-sm text-surface-400 opacity-40 select-none" aria-hidden="true">←</span>
    {/if}

    <div class="text-center min-w-0">
      <h1 class="text-base font-semibold text-surface-50 tabular-nums">{fmtDate(data.date)}</h1>
      {#if data.date === data.today}
        <span class="text-xs text-primary-400">Today</span>
      {:else}
        <a href="/" class="text-xs text-surface-400 hover:text-surface-200">Back to today</a>
      {/if}
    </div>

    {#if data.nextDate}
      <a href="/{data.nextDate}" class="tap flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-700 bg-surface-900 text-sm text-surface-200 no-underline hover:bg-surface-800">
        <span class="hidden xs:inline">{data.nextDate}</span>
        <span aria-hidden="true">→</span>
        <span class="sr-only">Next day, {data.nextDate}</span>
      </a>
    {:else}
      <span class="tap flex items-center px-3 py-2 rounded-lg border border-surface-800 text-sm text-surface-400 opacity-40 select-none" aria-hidden="true">→</span>
    {/if}
  </nav>

  {#if data.reportHtml}
    <div class="report-body">
      {@html data.reportHtml}
    </div>
  {:else}
    <div class="flex flex-col items-center gap-5 pt-10 text-center text-surface-300">
      {#if data.pipelineRun?.status === "running"}
        <p class="text-primary-400 text-sm inline-flex items-center gap-2">
          <Spinner label="Pipeline running" /> The pipeline is running.
        </p>
      {:else if data.pipelineRun?.status === "failed"}
        <ErrorCard
          step={data.pipelineRun.failedStep}
          durationMs={data.pipelineRun.durationMs}
          attempts={data.pipelineRun.stepErrors}
        />
      {:else}
        <p>No report for {fmtDate(data.date)}.</p>
      {/if}

      {#if !triggering && !form?.triggered && data.pipelineRun?.status !== "running"}
        <form
          method="POST"
          action="?/runPipeline"
          use:enhance={() => {
            triggering = true;
            return async ({ update }) => {
              await update();
              triggering = false;
            };
          }}
        >
          <button
            type="submit"
            class="tap px-6 py-2.5 bg-primary-900 border border-primary-600 text-primary-200 rounded-md text-sm cursor-pointer hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {data.pipelineRun?.status === "failed" ? "Retry" : "Run pipeline now"}
          </button>
        </form>
      {/if}
      {#if form?.error}
        <p class="text-error-400 text-sm">{form.error}</p>
      {/if}
      {#if form?.triggered}
        <p class="text-success-400 text-sm">Pipeline started.</p>
      {/if}
    </div>
  {/if}
</Page>
