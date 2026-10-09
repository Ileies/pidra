<script lang="ts">
  // Online-only step graph and cost tables for one run; maths in `$lib/runTrace.ts`, `runUsage.ts`, `pricing.ts`.
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import JevDecisionsCard from "#lib/components/JevDecisionsCard.svelte";
  import Legend from "#lib/components/Legend.svelte";
  import CostShareBar from "#lib/components/CostShareBar.svelte";
  import UsageTable from "#lib/components/UsageTable.svelte";
  import TimelineBar, { pct } from "#lib/components/TimelineBar.svelte";
  import { timelineSegments } from "#lib/runTimeline.js";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { fmtCost, fmtDate, fmtDuration, fmtNum, fmtMs, fmtTime } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
  import { busySteps, sumUsage, withWeights } from "#lib/runUsage.js";
  import {
    buildTree,
    groupInfo,
    groupTotals,
    GROUPS,
    stepLabel,
    stepTotals,
    TimeScale,
    waitWindow,
    type GroupTotal,
    type StepTotal,
  } from "#lib/runTrace.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const tree = $derived(buildTree(data.steps, data.run.durationMs ?? undefined));
  const hasSteps = $derived(tree.root != null);
  const wait = $derived(waitWindow(tree));
  const waitSpan = $derived(tree.spans.find((node) => node.step === "phase4-wait") ?? null);

  /** Compress the wait by default: otherwise a 45-minute wait turns every other bar into a hairline. */
  let compressWait = $state(true);
  const scale = $derived(new TimeScale(tree.totalMs, compressWait ? wait : null));

  const runMs = $derived(data.run.durationMs ?? tree.totalMs);
  const activeMs = $derived(Math.max(0, runMs - (waitSpan?.lengthMs ?? 0)));

  const groups = $derived(groupTotals(tree));
  const present = $derived(new Set(groups.map((entry) => entry.group)));
  const legend = $derived(GROUPS.filter((group) => present.has(group.id)));

  const steps = $derived(busySteps(stepTotals(tree)));
  const groupWeights = $derived(withWeights(groups));
  const weightSum = $derived(groupWeights.reduce((sum, entry) => sum + entry.weight, 0));
  const stepSum = $derived(sumUsage(steps));

  /** The report's token counts cover the whole run; the steps cover what the tracer saw. Usually equal. */
  const tokensIn = $derived(hasSteps ? stepSum.tokensIn : data.run.tokensIn);
  const tokensOut = $derived(hasSteps ? stepSum.tokensOut : data.run.tokensOut);
  const totalCost = $derived(costUsd(tokensIn, tokensOut));

  const failedSpans = $derived(tree.spans.filter((node) => node.status === "failed"));
  const failed = $derived(data.run.status === "failed");
  const degraded = $derived(!failed && data.run.stepErrors.length > 0);

  const segments = $derived(timelineSegments(tree));
  const hasParallel = $derived(segments.some((segment) => segment.groups.length > 1));

  const phaseRows = $derived(groupWeights.filter((entry) => entry.group !== "wait"));
  const cost = (value: number | null) => (PRICING_CONFIGURED ? fmtCost(value) : "-");

  const phaseColumns = [
    { header: "Calls", value: (entry: GroupTotal) => fmtNum(entry.aiCalls) },
    { header: "Tokens in", value: (entry: GroupTotal) => fmtNum(entry.tokensIn) },
    { header: "Tokens out", value: (entry: GroupTotal) => fmtNum(entry.tokensOut) },
    { header: "Searches", value: (entry: GroupTotal) => fmtNum(entry.searchCalls) },
    { header: "Time", value: (entry: GroupTotal) => fmtMs(entry.wallMs) },
    { header: "Cost", value: (entry: GroupTotal & { weight: number }) => cost(entry.weight) },
  ];

  const stepColumns = [
    { header: "Calls", value: (entry: StepTotal) => fmtNum(entry.aiCalls) },
    { header: "Tokens in", value: (entry: StepTotal) => fmtNum(entry.tokensIn) },
    { header: "Tokens out", value: (entry: StepTotal) => fmtNum(entry.tokensOut) },
    { header: "Searches", value: (entry: StepTotal) => fmtNum(entry.searchCalls) },
    { header: "Flex retries", value: (entry: StepTotal) => fmtNum(entry.flexRetries) },
    { header: "Cost", value: (entry: StepTotal) => cost(costUsd(entry.tokensIn, entry.tokensOut)) },
  ];

  $effect(() => {
    setPageContext({
      surface: "global",
      route: `/runs/${data.run.id}`,
      digest:
        `Run breakdown for ${data.run.runDate}: ${data.run.status}, ${fmtDuration(data.run.durationMs)} total` +
        (waitSpan ? `, of which ${fmtDuration(waitSpan.lengthMs)} waiting for question answers` : "") +
        (hasSteps ? `, ${data.steps.length} traced steps.` : ", no per-step timing recorded for this run."),
    });
  });
</script>

{#snippet swatch(color: string)}
  <span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style="background:{color}"></span>
{/snippet}

<Page title={`Run ${data.run.runDate}`} size="app" class="flex flex-col gap-5">
  <div class="flex flex-col gap-2">
    <a href="/runs" class="text-xs text-surface-400 no-underline hover:text-primary-400 w-fit">&larr; All runs</a>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-bold text-surface-50">{fmtDate(data.run.runDate)}</h1>
      <Badge tone={toneFor(data.run.status)}>
        {displayLabel(data.run.status)}
      </Badge>
      {#if data.run.startedAt}
        <span class="text-xs text-surface-400 tabular-nums">started {fmtTime(data.run.startedAt, false)}</span>
      {/if}
      <a href="/{data.run.runDate}" class="text-xs text-surface-400 hover:text-primary-400 ml-auto">Open the report</a>
    </div>
  </div>

  <div class="grid grid-cols-2 {data.run.audioCostUsd > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3">
    <StatCard label="Total time" value={fmtDuration(data.run.durationMs)} />
    {#if waitSpan}
      <StatCard label="Without the wait" value={fmtDuration(activeMs)} hint="Time the pipeline itself worked" />
    {:else}
      <StatCard label="Tokens" value={tokensIn != null ? `${fmtNum(tokensIn)} in` : "-"} hint={tokensOut != null ? `${fmtNum(tokensOut)} out` : undefined} />
    {/if}
    <StatCard
      label="Cost"
      value={totalCost != null ? fmtCost(totalCost) : "-"}
      hint={PRICING_CONFIGURED ? undefined : PRICING_HINT}
    />
    {#if data.run.audioCostUsd > 0}<StatCard label="Audio cost" value={fmtCost(data.run.audioCostUsd)} hint="Estimate, not in the run cost" />{/if}
    <StatCard
      label={hasSteps ? "Model calls" : "Items in report"}
      value={hasSteps ? fmtNum(stepSum.aiCalls) : data.run.itemsIncluded != null ? fmtNum(data.run.itemsIncluded) : "-"}
      hint={hasSteps ? `${fmtNum(stepSum.searchCalls)} searches, ${fmtNum(stepSum.flexRetries)} flex retries` : undefined}
    />
  </div>

  <JevDecisionsCard rows={data.jev} />

  {#if waitSpan}
    {@const outcome = waitSpan.detail?.outcome}
    <Card tone="warning" class="px-4 py-3 flex flex-col gap-1">
      <div class="text-sm text-warning-400 font-medium">
        {fmtDuration(waitSpan.lengthMs)} of this run was spent waiting for answers
        ({Math.round((waitSpan.lengthMs / Math.max(1, runMs)) * 100)}% of the total)
      </div>
      <p class="text-xs text-surface-300 max-w-prose">
        Section 2 holds until the questions this run raised are answered, or the
        {waitSpan.detail?.timeoutMinutes ?? 45}-minute timeout passes.
        {#if outcome === "timed_out"}
          Nobody answered: {waitSpan.detail?.unanswered} of {waitSpan.detail?.questions} question(s) were still open
          at the deadline, and they stay on <a href="/questions">/questions</a>.
        {:else if outcome === "answered"}
          All {waitSpan.detail?.questions} question(s) were answered.
        {/if}
      </p>
    </Card>
  {/if}

  {#if failed || degraded}
    <ErrorCard
      step={data.run.failedStep}
      durationMs={data.run.durationMs}
      attempts={data.run.stepErrors}
      variant={degraded ? "degraded" : "failed"}
    />
  {/if}

  {#if !hasSteps}
    <Card class="px-4 py-4 text-sm text-surface-300 max-w-prose">
      No per-step timing was recorded for this run. Step timing starts with the first run after it was
      added (2026-10-01), so older runs only have the totals above.
    </Card>
  {:else}
    <Card as="section" class="px-4 py-4 flex flex-col gap-4" aria-labelledby="time-h">
      <div class="flex flex-wrap items-center gap-3">
        <h2 id="time-h" class="text-sm font-semibold text-surface-100">Time</h2>
        {#if wait}
          <label class="ml-auto flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
            <input type="checkbox" bind:checked={compressWait} class="accent-primary-500" />
            Shrink the wait
          </label>
        {/if}
      </div>

      <Legend items={legend} />

      {#if compressWait && scale.compressed}
        <p class="text-xs text-surface-400">
          The waiting stretch is drawn shorter than it was so the other steps stay readable. Untick
          "Shrink the wait" for true scale.
        </p>
      {/if}

      <div class="relative h-4 text-xs text-surface-400 tabular-nums" aria-hidden="true">
        {#each scale.ticks(4) as tick, i (tick)}
          <span
            class="absolute top-0 whitespace-nowrap"
            style="left:{pct(scale.at(tick))};transform:translateX({i === 0 ? '0' : scale.at(tick) > 0.92 ? '-100%' : '-50%'})"
          >{tick === 0 ? "0" : `+${fmtMs(tick)}`}</span>
        {/each}
      </div>

      <TimelineBar {segments} {scale} />

      {#if hasParallel}
        <p class="text-xs text-surface-400">Dashed stripes mark stretches where several phases ran at the same time.</p>
      {/if}

      <details class="group">
        <summary class="tap text-xs text-surface-400 select-none hover:text-surface-200">Details</summary>
        <ul class="mt-2 flex flex-col gap-1">
          {#each tree.spans as node (node.id)}
            <li
              class="flex items-baseline gap-2 text-xs min-w-0"
              style="padding-left:{Math.min(node.depth - 1, 4) * 0.75}rem"
              title="Starts at +{fmtMs(node.offsetMs)}"
            >
              {@render swatch(groupInfo(node.group).color)}
              <span class="text-surface-200 truncate min-w-0">{stepLabel(node.step)}</span>
              {#if node.attempt > 1}<span class="text-surface-400 shrink-0">attempt {node.attempt}</span>{/if}
              {#if node.status === "failed"}
                <span class="text-error-400 shrink-0">failed</span>
              {:else if node.status === "running"}
                <span class="text-primary-400 shrink-0">unfinished</span>
              {/if}
              <span class="ml-auto text-surface-400 tabular-nums shrink-0">{fmtMs(node.lengthMs)}</span>
            </li>
          {/each}
        </ul>
      </details>

      {#if failedSpans.length > 0}
        <p class="text-xs text-surface-400">
          {failedSpans.length} attempt{failedSpans.length === 1 ? "" : "s"} failed and {failedSpans.length === 1 ? "was" : "were"} retried
          or skipped; each attempt is its own row.
        </p>
      {/if}
    </Card>

    <Card as="section" class="px-4 py-4 flex flex-col gap-4" aria-labelledby="cost-h">
      <h2 id="cost-h" class="text-sm font-semibold text-surface-100">Cost</h2>

      {#if weightSum <= 0}
        <p class="text-xs text-surface-400">No model usage was recorded for the traced steps.</p>
      {:else}
        <p class="text-xs text-surface-400 max-w-prose">
          {PRICING_CONFIGURED ? "Share of the run's spend" : "Share of the run's tokens (no prices configured)"} per phase.
          Brave searches have no token cost and are counted in the table.
        </p>

        <CostShareBar entries={groupWeights} />

        <UsageTable
          caption="Usage and cost per phase"
          first="Phase"
          columns={phaseColumns}
          rows={phaseRows}
          key={(entry) => entry.group}
          total={{
            label: "Total",
            values: [
              fmtNum(stepSum.aiCalls),
              fmtNum(stepSum.tokensIn),
              fmtNum(stepSum.tokensOut),
              fmtNum(stepSum.searchCalls),
              fmtMs(runMs),
              cost(totalCost),
            ],
          }}
        >
          {#snippet rowHeader(entry)}
            {@render swatch(groupInfo(entry.group).color)}
            {groupInfo(entry.group).label}
          {/snippet}
        </UsageTable>

        <h3 class="text-xs font-semibold text-surface-200 mt-1">By step</h3>
        <UsageTable
          caption="Usage and cost per step, most expensive first"
          first="Step"
          columns={stepColumns}
          rows={steps}
          key={(entry) => entry.step}
        >
          {#snippet rowHeader(entry)}
            {@render swatch(groupInfo(entry.group).color)}
            {stepLabel(entry.step)}{#if entry.attempts > 1}<span class="text-surface-400"> x{entry.attempts}</span>{/if}
          {/snippet}
        </UsageTable>
      {/if}
    </Card>
  {/if}
</Page>
