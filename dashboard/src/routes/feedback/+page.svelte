<script lang="ts">
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDateTimeShort, fmtNum, fmtScore } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  $effect(() => {
    setPageContext({
      surface: "sources",
      route: "/feedback",
      digest: `Rating log: ${data.totals.plus} positive, ${data.totals.minus} negative, ${data.totals.implicit} implicit signals.`,
    });
  });

  function tone(eventType: string): "success" | "error" | "muted" {
    if (eventType === "explicit_plus") return "success";
    if (eventType === "explicit_minus") return "error";
    return "muted";
  }

  function glyph(eventType: string): string {
    if (eventType === "explicit_plus") return "+";
    if (eventType === "explicit_minus") return "−";
    return "·";
  }
</script>

<Page title="Feedback" size="app" class="flex flex-col gap-5">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Rating log</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      What you rated, and what the pipeline had decided about it. The per-source totals on a
      source's own page are the sum of these. Implicit signals - the behavioural ones written at
      22:00 daily - feed the same scoring, so they are shown too rather than left out to make the
      explicit ratings look more influential than they are.
    </p>
  </div>

  <div class="grid grid-cols-3 gap-3">
    <StatCard label="Rated positive" value={fmtNum(data.totals.plus)} tone="success" />
    <StatCard label="Rated negative" value={fmtNum(data.totals.minus)} tone="error" />
    <StatCard label="Implicit signals" value={fmtNum(data.totals.implicit)} tone="muted" />
  </div>

  <div class="flex flex-wrap items-center gap-1">
    {#each [["explicit", "Yours only"], ["all", "Everything"]] as [value, filterLabel] (value)}
      <a
        href="/feedback?only={value}"
        aria-current={data.only === value ? "true" : undefined}
        class="tap px-3 py-1 rounded text-xs border no-underline transition-colors
          {data.only === value
            ? 'bg-surface-700 border-surface-500 text-surface-50'
            : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200'}"
      >{filterLabel}</a>
    {/each}
  </div>

  {#if data.events.length === 0}
    <EmptyState
      title="Nothing rated yet."
      hint="The +/- controls sit on every report entry with a source behind it, so rating one is a single tap while you read."
    />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.events as event (event.id)}
        <li class="rounded-lg border border-surface-800 bg-surface-900 px-4 py-2.5 flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-sm font-bold
                {event.eventType === 'explicit_plus'
                  ? 'border-success-700 bg-success-950 text-success-400'
                  : event.eventType === 'explicit_minus'
                    ? 'border-error-700 bg-error-950 text-error-400'
                    : 'border-surface-700 bg-surface-950 text-surface-400'}"
              aria-hidden="true"
            >{glyph(event.eventType)}</span>

            {#if event.extractionId && event.runDate && event.hasReport}
              <a
                href="/{event.runDate}/detail/{event.extractionId}"
                class="text-sm text-surface-100 no-underline hover:text-primary-400 min-w-0 break-words"
              >{event.headline ?? "(no headline)"}</a>
            {:else}
              <span class="text-sm text-surface-200 min-w-0 break-words">{event.headline ?? "(item no longer available)"}</span>
            {/if}

            <span class="text-xs text-surface-400 ml-auto whitespace-nowrap">{fmtDateTimeShort(event.createdAt)}</span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs text-surface-400 pl-8">
            {#if event.sourceName}
              <a href="/sources/{encodeURIComponent(event.sourceName)}" class="text-surface-300 no-underline hover:text-primary-400 break-all">
                {event.sourceName}
              </a>
            {/if}
            {#if !event.eventType.startsWith("explicit_")}
              <Badge tone="muted">{displayLabel(event.eventType)}</Badge>
            {/if}
            {#if event.includedInReport}
              <Badge tone={tone(event.eventType)}>Was in the report</Badge>
            {:else}
              <Badge tone="muted">Filtered out</Badge>
            {/if}
            {#if event.effectiveRelevance != null}
              <span class="tabular-nums">relevance {fmtScore(event.effectiveRelevance)}</span>
            {/if}
            {#if event.runDate}
              <a href="/{event.runDate}" class="text-surface-400 no-underline hover:text-surface-200 tabular-nums">{event.runDate}</a>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Page>
