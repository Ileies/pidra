<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { onDestroy } from "svelte";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import Page from "$lib/components/Page.svelte";
  import StatBar from "$lib/components/StatBar.svelte";
  import ErrorCard from "$lib/components/ErrorCard.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import DayNav from "$lib/report/DayNav.svelte";
  import ReportEntry from "$lib/report/ReportEntry.svelte";
  import SectionNav from "$lib/report/SectionNav.svelte";
  import { URGENCY_META, type NavTarget } from "$lib/report/types";
  import { fmtCost, fmtDate, fmtNum } from "$lib/format";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "$lib/pricing";
  import { toastFormResult } from "$lib/toast.svelte";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

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

  // --- ratings: optimistic, re-synced whenever the load function returns ---

  let ratings = $state<Record<string, string | null>>({});
  $effect(() => {
    ratings = { ...data.ratings };
  });

  function onRate(extractionId: string, eventType: string | null) {
    ratings[extractionId] = eventType;
  }

  // --- stats ---

  const cost = $derived(costUsd(data.report?.tokensIn, data.report?.tokensOut));
  const costTitle = $derived(PRICING_CONFIGURED ? `Run cost: ${fmtCost(cost)}` : PRICING_HINT);

  const stats = $derived(
    data.report
      ? [
          { label: "ingested", value: fmtNum(data.report.itemCount) },
          { label: "included", value: fmtNum(data.report.itemsIncluded) },
          { label: "tokens in", value: fmtNum(data.report.tokensIn), title: costTitle },
          { label: "tokens out", value: fmtNum(data.report.tokensOut), title: costTitle },
          ...(data.report.aiCalls != null ? [{ label: "AI calls", value: fmtNum(data.report.aiCalls) }] : []),
          ...(data.report.webSearchesRun ? [{ label: "web searches", value: fmtNum(data.report.webSearchesRun) }] : []),
          ...(cost != null ? [{ label: "cost", value: fmtCost(cost) }] : []),
        ]
      : [],
  );

  // --- section order and navigation (C3, C6) ---

  const personalEntries = $derived(
    data.structured?.personal.reduce((sum, group) => sum + group.entries.length, 0) ?? 0,
  );

  const domainTargets = $derived<NavTarget[]>(
    (data.structured?.intel ?? []).map((group, index) => ({
      id: `domain-${index}`,
      label: group.domain,
    })),
  );

  const sectionTargets = $derived<NavTarget[]>(
    [
      personalEntries > 0 ? { id: "personal", label: "Personal" } : null,
      (data.structured?.intel.length ?? 0) > 0 ? { id: "intel", label: "Briefing" } : null,
      (data.structured?.alsoNoted.length ?? 0) > 0 ? { id: "also-noted", label: "Also noted" } : null,
    ].filter((target): target is NavTarget => target !== null),
  );

  // --- live pipeline status (C7) ---

  let triggering = $state(false);
  let polling = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let liveStatus = $state<string | null>(null);

  /**
   * Replaces "reload the page in ~5 min". /context-builder in this same codebase already polled
   * and drew progress bars; the report just told the reader to come back later.
   */
  function startPolling() {
    if (pollTimer) return;
    polling = true;
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/status?date=${data.date}`);
        if (!res.ok) return;
        const body = (await res.json()) as { hasReport: boolean; run: { status: string } | null };
        liveStatus = body.run?.status ?? null;

        if (body.hasReport || body.run?.status === "failed") {
          stopPolling();
          await invalidateAll();
        }
      } catch {
        // transient - the next tick retries
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    polling = false;
  }

  $effect(() => {
    if (!data.report && (data.pipelineRun?.status === "running" || triggering || form?.triggered)) startPolling();
    else stopPolling();
  });

  onDestroy(stopPolling);
</script>

{#snippet statsBar()}
  {#if data.report}
    <StatBar {stats} />
  {/if}
{/snippet}

<Page title={data.date} size="read" bleed={statsBar} class="flex flex-col gap-5">
  <DayNav date={data.date} today={data.today} prevDate={data.prevDate} nextDate={data.nextDate} />

  {#if data.structured}
    {#if sectionTargets.length > 1}
      <SectionNav sections={sectionTargets} domains={domainTargets} />
    {/if}

    <!-- Section 2 leads, at every width (decision 3). It is the actionable half; the briefing
         is the half you read when you have time. -->
    {#if personalEntries > 0}
      <section id="personal" tabindex="-1" class="flex flex-col gap-5 scroll-mt-[calc(var(--header-h)+3.5rem)]">
        <h2 class="text-lg font-semibold text-surface-50 border-b border-surface-700 pb-2">Personal Action Center</h2>

        {#each data.structured.personal as group (group.urgency)}
          {@const meta = URGENCY_META[group.urgency]}
          <div class="flex flex-col gap-3">
            <!-- The chip carries the meaning; the hue only reinforces it (A4, P7). -->
            <h3 class="flex items-center gap-2 text-sm font-semibold text-surface-200">
              <span class="badge border {meta.tone === 'error' ? 'bg-error-950 border-error-800 text-error-400' : meta.tone === 'warning' ? 'bg-warning-950 border-warning-800 text-warning-400' : 'bg-surface-900 border-surface-700 text-surface-300'}">
                {meta.label}
              </span>
              <span class="text-xs font-normal text-surface-400">{group.entries.length}</span>
            </h3>
            {#each group.entries as entry, index (index)}
              <ReportEntry {entry} date={data.date} {ratings} {onRate} accent={meta.accent} />
            {/each}
          </div>
        {/each}
      </section>
    {:else}
      <!-- An empty panel above the fold is worse than no panel. -->
      <p class="text-sm text-surface-300">Nothing needs action today.</p>
    {/if}

    {#if data.structured.intel.length > 0}
      <section id="intel" tabindex="-1" class="flex flex-col gap-6 scroll-mt-[calc(var(--header-h)+3.5rem)]">
        <h2 class="text-lg font-semibold text-surface-50 border-b border-surface-700 pb-2">Intelligence Briefing</h2>

        {#each data.structured.intel as group, index (group.domain)}
          <div id="domain-{index}" tabindex="-1" class="flex flex-col gap-3 scroll-mt-[calc(var(--header-h)+3.5rem)]">
            <h3 class="text-sm font-semibold uppercase tracking-wider text-surface-300">{group.domain}</h3>
            {#each group.entries as entry, entryIndex (entryIndex)}
              <ReportEntry {entry} date={data.date} {ratings} {onRate} />
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    {#if data.structured.alsoNoted.length > 0}
      <section id="also-noted" tabindex="-1" class="flex flex-col gap-3 scroll-mt-[calc(var(--header-h)+3.5rem)]">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-surface-300 border-b border-surface-800 pb-2">
          Also noted
        </h2>
        {#each data.structured.alsoNoted as entry, index (index)}
          <ReportEntry {entry} date={data.date} {ratings} {onRate} />
        {/each}
      </section>
    {/if}
  {:else if data.reportHtml}
    <!-- The parser found no section headings, or this row predates report_json. The markdown
         renders exactly as it always did, so a prompt drift degrades the layout rather than
         emptying the page (C1). -->
    <div class="report-body">
      {@html data.reportHtml}
    </div>
  {:else}
    <div class="flex flex-col items-center gap-5 pt-10 text-center text-surface-300">
      {#if polling || data.pipelineRun?.status === "running"}
        <p class="text-primary-400 text-sm inline-flex items-center gap-2">
          <Spinner label="Pipeline running" />
          The pipeline is running{liveStatus && liveStatus !== "running" ? ` (${liveStatus})` : ""}. This page updates itself.
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

      {#if !triggering && !polling && data.pipelineRun?.status !== "running"}
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
    </div>
  {/if}
</Page>
