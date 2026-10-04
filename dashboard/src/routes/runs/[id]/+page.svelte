<script lang="ts">
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { fmtCost, fmtDate, fmtDuration, fmtNum, fmtMs, fmtTime } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
  import {
    buildTree,
    groupInfo,
    groupTotals,
    GROUPS,
    stepLabel,
    stepTotals,
    TimeScale,
    waitWindow,
    type SpanNode,
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

  const activeMs = $derived(Math.max(0, (data.run.durationMs ?? tree.totalMs) - (waitSpan?.lengthMs ?? 0)));

  const groups = $derived(groupTotals(tree));
  const present = $derived(new Set(groups.map((entry) => entry.group)));
  const legend = $derived(GROUPS.filter((group) => present.has(group.id)));

  const steps = $derived(
    stepTotals(tree)
      .filter((entry) => entry.aiCalls + entry.searchCalls + entry.tokensIn + entry.tokensOut > 0)
      .sort((a, b) => weight(b.tokensIn, b.tokensOut) - weight(a.tokensIn, a.tokensOut)),
  );

  /** What a share is a share *of*: dollars when priced, tokens otherwise. */
  function weight(tokensIn: number, tokensOut: number): number {
    return PRICING_CONFIGURED ? (costUsd(tokensIn, tokensOut) ?? 0) : tokensIn + tokensOut;
  }

  const groupWeights = $derived(groups.map((entry) => ({ ...entry, weight: weight(entry.tokensIn, entry.tokensOut) })));
  const weightSum = $derived(groupWeights.reduce((sum, entry) => sum + entry.weight, 0));

  const stepSum = $derived(
    steps.reduce(
      (sum, entry) => ({
        tokensIn: sum.tokensIn + entry.tokensIn,
        tokensOut: sum.tokensOut + entry.tokensOut,
        aiCalls: sum.aiCalls + entry.aiCalls,
        searchCalls: sum.searchCalls + entry.searchCalls,
        flexRetries: sum.flexRetries + entry.flexRetries,
      }),
      { tokensIn: 0, tokensOut: 0, aiCalls: 0, searchCalls: 0, flexRetries: 0 },
    ),
  );

  /** The report's token counts cover the whole run; the steps cover what the tracer saw. Usually equal. */
  const tokensIn = $derived(hasSteps ? stepSum.tokensIn : data.run.tokensIn);
  const tokensOut = $derived(hasSteps ? stepSum.tokensOut : data.run.tokensOut);
  const totalCost = $derived(costUsd(tokensIn, tokensOut));

  const failedSpans = $derived(tree.spans.filter((node) => node.status === "failed"));
  const failed = $derived(data.run.status === "failed");
  const degraded = $derived(!failed && data.run.stepErrors.length > 0);

  let openRow = $state<string | null>(null);

  function pct(value: number): string {
    return `${(value * 100).toFixed(3)}%`;
  }

  function barStyle(node: SpanNode): string {
    const left = scale.at(node.offsetMs);
    const right = scale.at(node.offsetMs + node.lengthMs);
    return `left:${pct(left)};width:max(3px, ${pct(Math.max(0, right - left))});background:${groupInfo(node.group).color}`;
  }

  function rowTitle(node: SpanNode): string {
    return `${stepLabel(node.step)}${node.attempt > 1 ? ` (attempt ${node.attempt})` : ""}: ${fmtMs(node.lengthMs)}, starts at +${fmtMs(node.offsetMs)}`;
  }

  function detailEntries(node: SpanNode): [string, string][] {
    return Object.entries(node.detail ?? {}).map(([key, value]) => [
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    ]);
  }

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

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
    <StatCard
      label={hasSteps ? "Model calls" : "Items in report"}
      value={hasSteps ? fmtNum(stepSum.aiCalls) : data.run.itemsIncluded != null ? fmtNum(data.run.itemsIncluded) : "-"}
      hint={hasSteps ? `${fmtNum(stepSum.searchCalls)} searches, ${fmtNum(stepSum.flexRetries)} flex retries` : undefined}
    />
  </div>

  {#if waitSpan}
    {@const outcome = waitSpan.detail?.outcome}
    <div class="rounded-lg border border-warning-800 bg-warning-950 px-4 py-3 flex flex-col gap-1">
      <div class="text-sm text-warning-400 font-medium">
        {fmtDuration(waitSpan.lengthMs)} of this run was spent waiting for answers
        ({Math.round((waitSpan.lengthMs / Math.max(1, data.run.durationMs ?? tree.totalMs)) * 100)}% of the total)
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
    </div>
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

      <ul class="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
        {#each legend as group (group.id)}
          <li class="flex items-center gap-1.5 text-xs text-surface-300">
            <span class="inline-block w-3 h-3 rounded-sm" style="background:{group.color}"></span>
            {group.label}
          </li>
        {/each}
      </ul>

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

      <ul class="flex flex-col gap-1">
        {#each tree.spans as node (node.id)}
          {@const isOpen = openRow === node.id}
          {@const entries = detailEntries(node)}
          <li class="min-w-0">
            <button
              type="button"
              aria-expanded={isOpen}
              title={rowTitle(node)}
              onclick={() => (openRow = isOpen ? null : node.id)}
              class="w-full text-left flex flex-col gap-1 rounded px-1 py-1 hover:bg-surface-800 min-w-0"
            >
              <span class="flex items-baseline gap-2 text-xs min-w-0" style="padding-left:{Math.min(node.depth - 1, 4) * 0.75}rem">
                <span class="text-surface-200 truncate min-w-0">{stepLabel(node.step)}</span>
                {#if node.attempt > 1}
                  <span class="text-surface-400 shrink-0">attempt {node.attempt}</span>
                {/if}
                {#if node.status === "failed"}
                  <span class="text-error-400 shrink-0">failed</span>
                {:else if node.status === "running"}
                  <span class="text-primary-400 shrink-0">unfinished</span>
                {/if}
                <span class="ml-auto text-surface-400 tabular-nums shrink-0">{fmtMs(node.lengthMs)}</span>
              </span>
              <span class="relative block h-2.5 rounded bg-surface-800 overflow-hidden">
                <span
                  class="absolute top-0 h-full rounded {node.status === 'failed' ? 'outline outline-2 -outline-offset-2 outline-error-500' : ''}"
                  style={barStyle(node)}
                ></span>
              </span>
            </button>
            {#if isOpen}
              <dl class="mt-1 mb-2 ml-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-surface-300">
                <dt class="text-surface-400">Starts</dt>
                <dd class="tabular-nums">+{fmtMs(node.offsetMs)}</dd>
                <dt class="text-surface-400">Step id</dt>
                <dd class="font-mono break-all">{node.step}</dd>
                {#if node.total.aiCalls + node.total.searchCalls > 0}
                  <dt class="text-surface-400">Model calls</dt>
                  <dd class="tabular-nums">
                    {fmtNum(node.total.aiCalls)} ({fmtNum(node.total.tokensIn)} in, {fmtNum(node.total.tokensOut)} out)
                    {#if PRICING_CONFIGURED}, {fmtCost(costUsd(node.total.tokensIn, node.total.tokensOut))}{/if}
                  </dd>
                  <dt class="text-surface-400">Searches</dt>
                  <dd class="tabular-nums">{fmtNum(node.total.searchCalls)}</dd>
                  <dt class="text-surface-400">Flex retries</dt>
                  <dd class="tabular-nums">{fmtNum(node.total.flexRetries)}</dd>
                {/if}
                {#each entries as [key, value] (key)}
                  <dt class="text-surface-400">{key}</dt>
                  <dd class="break-words">{value}</dd>
                {/each}
              </dl>
            {/if}
          </li>
        {/each}
      </ul>

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

        <div class="flex h-3 w-full overflow-hidden rounded" role="img" aria-label="Cost share by phase">
          {#each groupWeights.filter((entry) => entry.weight > 0) as entry (entry.group)}
            <span
              class="h-full first:rounded-l last:rounded-r min-w-[3px]"
              style="width:{(entry.weight / weightSum) * 100}%;background:{groupInfo(entry.group).color};margin-right:2px"
              title="{groupInfo(entry.group).label}: {PRICING_CONFIGURED ? fmtCost(entry.weight) : `${fmtNum(entry.weight)} tokens`}"
            ></span>
          {/each}
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-xs tabular-nums">
            <caption class="sr-only">Usage and cost per phase</caption>
            <thead class="text-surface-400 text-left">
              <tr>
                <th scope="col" class="font-normal pb-1 pr-3">Phase</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Calls</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Tokens in</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Tokens out</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Searches</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Time</th>
                <th scope="col" class="font-normal pb-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody class="text-surface-200">
              {#each groupWeights.filter((entry) => entry.group !== "wait") as entry (entry.group)}
                <tr class="border-t border-surface-800">
                  <th scope="row" class="font-normal text-left py-1.5 pr-3 whitespace-nowrap">
                    <span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style="background:{groupInfo(entry.group).color}"></span>
                    {groupInfo(entry.group).label}
                  </th>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.aiCalls)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.tokensIn)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.tokensOut)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.searchCalls)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtMs(entry.wallMs)}</td>
                  <td class="py-1.5 text-right">{PRICING_CONFIGURED ? fmtCost(entry.weight) : "-"}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="text-surface-50">
              <tr class="border-t border-surface-600">
                <th scope="row" class="font-medium text-left py-1.5 pr-3">Total</th>
                <td class="py-1.5 pr-3 text-right">{fmtNum(stepSum.aiCalls)}</td>
                <td class="py-1.5 pr-3 text-right">{fmtNum(stepSum.tokensIn)}</td>
                <td class="py-1.5 pr-3 text-right">{fmtNum(stepSum.tokensOut)}</td>
                <td class="py-1.5 pr-3 text-right">{fmtNum(stepSum.searchCalls)}</td>
                <td class="py-1.5 pr-3 text-right">{fmtMs(data.run.durationMs ?? tree.totalMs)}</td>
                <td class="py-1.5 text-right">{PRICING_CONFIGURED ? fmtCost(totalCost) : "-"}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h3 class="text-xs font-semibold text-surface-200 mt-1">By step</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs tabular-nums">
            <caption class="sr-only">Usage and cost per step, most expensive first</caption>
            <thead class="text-surface-400 text-left">
              <tr>
                <th scope="col" class="font-normal pb-1 pr-3">Step</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Calls</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Tokens in</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Tokens out</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Searches</th>
                <th scope="col" class="font-normal pb-1 pr-3 text-right">Flex retries</th>
                <th scope="col" class="font-normal pb-1 text-right">Cost</th>
              </tr>
            </thead>
            <tbody class="text-surface-200">
              {#each steps as entry (entry.step)}
                <tr class="border-t border-surface-800">
                  <th scope="row" class="font-normal text-left py-1.5 pr-3 whitespace-nowrap">
                    <span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style="background:{groupInfo(entry.group).color}"></span>
                    {stepLabel(entry.step)}{#if entry.attempts > 1}<span class="text-surface-400"> x{entry.attempts}</span>{/if}
                  </th>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.aiCalls)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.tokensIn)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.tokensOut)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.searchCalls)}</td>
                  <td class="py-1.5 pr-3 text-right">{fmtNum(entry.flexRetries)}</td>
                  <td class="py-1.5 text-right">{PRICING_CONFIGURED ? fmtCost(costUsd(entry.tokensIn, entry.tokensOut)) : "-"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>
  {/if}
</Page>
