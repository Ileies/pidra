<script lang="ts">
  /**
   * Triage: everything that arrived on one run date and what became of it.
   *
   * The report is the system's answer. This is its working, and it exists because on 2026-09-12 a
   * mail the reader knew had arrived was simply not in the briefing, and there was no way to find
   * out whether it had been dropped at ingest, never extracted, filtered by the relevance gate, or
   * read by synthesis and passed over. Those four are one sentence apart here.
   *
   * Filtering and searching are client-side on purpose: a run is a few hundred rows, they are all
   * on the page already, and a round trip per keystroke would buy nothing.
   */
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Page from "#lib/components/Page.svelte";
  import StatBar from "#lib/components/StatBar.svelte";
  import TriageCard from "#lib/report/TriageCard.svelte";
  import { fmtDate } from "#lib/format.js";
  import type { Outcome } from "#lib/server/triage.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  $effect(() => {
    setPageContext({
      surface: "report",
      route: `/${data.date}/triage`,
      digest:
        `Triage for ${data.date}: ${data.summary.ingested} mails ingested, ${data.summary.inReport} cited in the ` +
        `report, ${data.summary.passed} reached synthesis without being cited, ${data.summary.gated} dropped at ` +
        `the relevance gate, ${data.summary.notExtracted} never extracted, ${data.summary.droppedAtIngest} ` +
        `dropped before ingest. Reports are final; what can change is a note or a standing rule for tomorrow.`,
    });
  });

  // --- filters ---

  type Filter = "all" | Outcome;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "Everything" },
    { key: "in_report", label: "In the report" },
    { key: "passed", label: "Reached synthesis" },
    { key: "gated", label: "Dropped at the gate" },
    { key: "failed", label: "Extraction failed" },
    { key: "not_extracted", label: "Never extracted" },
    { key: "dropped_at_ingest", label: "Dropped at ingest" },
    { key: "unjudged", label: "No verdict" },
  ];

  let filter = $state<Filter>("all");
  let query = $state("");

  const counts = $derived(
    data.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.outcome] = (acc[item.outcome] ?? 0) + 1;
      return acc;
    }, {}),
  );

  /** A chip for an outcome nothing landed in is a dead control, so it is not rendered. */
  const chips = $derived(
    FILTERS.filter((f) => f.key === "all" || (counts[f.key] ?? 0) > 0).map((f) => ({
      ...f,
      count: f.key === "all" ? data.items.length : (counts[f.key] ?? 0),
    })),
  );

  const visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return data.items.filter((item) => {
      if (filter !== "all" && item.outcome !== filter) return false;
      if (!needle) return true;
      return [
        item.subject,
        item.sender,
        item.sourceName,
        item.account,
        ...item.extractions.map((e) => e.headline),
        ...item.extractions.map((e) => e.keyClaim),
      ].some((field) => field?.toLowerCase().includes(needle));
    });
  });

  const stats = $derived([
    { label: "mails ingested", value: data.summary.ingested },
    { label: "extracted items", value: data.summary.extractions },
    { label: "in the report", value: data.summary.inReport },
    { label: "dropped at the gate", value: data.summary.gated },
    ...(data.summary.droppedAtIngest > 0
      ? [{ label: "dropped at ingest", value: data.summary.droppedAtIngest }]
      : []),
  ]);
</script>

{#snippet statsBar()}
  <StatBar {stats} />
{/snippet}

<Page title="Triage {data.date}" size="app" bleed={statsBar} class="flex flex-col gap-4">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <div class="flex flex-col gap-0.5">
      <h1 class="text-lg font-semibold text-surface-50">Triage - {fmtDate(data.date)}</h1>
      <p class="text-xs text-surface-400">
        Every mail and feed item of this run, and where it stopped.
      </p>
    </div>
    <a href="/{data.date}" class="text-xs text-primary-400 no-underline hover:text-primary-300">← Back to the report</a>
  </div>

  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by outcome">
      {#each chips as chip (chip.key)}
        <button
          type="button"
          aria-pressed={filter === chip.key}
          onclick={() => (filter = chip.key)}
          class="tap px-3 py-1.5 rounded-full border text-xs cursor-pointer transition-colors
            {filter === chip.key
              ? 'bg-primary-900 border-primary-600 text-primary-200'
              : 'bg-surface-900 border-surface-700 text-surface-300 hover:bg-surface-800'}"
        >
          {chip.label}
          <span class="tabular-nums text-surface-400">{chip.count}</span>
        </button>
      {/each}
    </div>

    <input
      type="search"
      bind:value={query}
      placeholder="Search subject, sender, source or headline"
      aria-label="Search this run"
      class="w-full rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder:text-surface-400 focus:border-primary-600 focus:outline-none"
    />
  </div>

  <!-- First, because it outranks everything below it: a mailbox that never answered has no items
       here, and its absence looks exactly like an empty inbox. Phase 1 deliberately carries on
       when one source dies, so nothing else on the page hints that half the mail was never
       fetched. -->
  {#if data.summary.ingestFailures.length > 0}
    <div class="rounded-lg border border-warning-800 bg-warning-950 px-3 py-2 text-xs text-warning-400 flex flex-col gap-1">
      <p class="font-semibold">
        Ingest was incomplete on this day - {data.summary.ingestFailures.length}
        {data.summary.ingestFailures.length === 1 ? "source" : "sources"} failed.
      </p>
      <ul class="flex flex-col gap-0.5">
        {#each data.summary.ingestFailures as failure (failure.source + failure.error)}
          <li><span class="font-medium">{failure.source}</span> - {failure.error}</li>
        {/each}
      </ul>
      <p>
        A mail from one of those sources cannot be listed below: it was never fetched, so nothing
        about it ever reached the database. <a href="/runs" class="text-warning-400 underline">The run log</a>
        has the attempts.
      </p>
    </div>
  {/if}

  {#if data.summary.hasReconstructed}
    <p class="rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-xs text-surface-400">
      Some verdicts on this day were reconstructed after the fact, because the run predates the gate
      keeping a record. The rule replayed is the real one; the source trust score of that morning is
      gone, so 1.0 stands in for it and those scores can read slightly high.
    </p>
  {/if}

  {#if visible.length === 0}
    <EmptyState
      title={data.items.length === 0
        ? "Nothing was ingested on this day."
        : "No item matches this filter."}
      hint={data.items.length === 0
        ? "Either the pipeline never ran, or every source came back empty. /runs has the run itself."
        : undefined}
    />
  {:else}
    <p class="text-xs text-surface-400">
      {visible.length}
      {visible.length === 1 ? "item" : "items"}{filter === "all" && !query ? "" : ` of ${data.items.length}`}
    </p>

    <div class="flex flex-col gap-2">
      {#each visible as item (item.id)}
        <TriageCard {item} date={data.date} />
      {/each}
    </div>
  {/if}

  <p class="border-t border-surface-800 pt-3 text-xs text-surface-400">
    Mail and feed items only - calendar entries and todos never pass through extraction. A message
    already ingested on an earlier run is not repeated here; it sits under the day it first arrived.
    A mail that the mailbox never handed over - outside the fetch window, in another folder, or
    filtered by the provider - cannot appear at all, because nothing about it ever reached PIDRA.
  </p>
</Page>
