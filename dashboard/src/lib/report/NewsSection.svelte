<script lang="ts">
  /**
   * The News section: what happened since the last briefing, found by the news desks.
   *
   * It sits between the two older sections: what needs acting on, then what happened, then the
   * newsletters' depth. Each group is a heading the editor wrote (Top stories, the home area, one
   * per field, Talk of the day, Something different). An entry carries its source links inline -
   * attached by the pipeline from the checked sources, never written by the model - and expands
   * into the stories behind it and can be rated, like every other entry.
   */
  import ReportEntry from "#lib/report/ReportEntry.svelte";
  import { failureLabel, isNewsDesk, type IngestFailure } from "#lib/pipeline.js";
  import type { RenderedEntry } from "#lib/server/reports.js";

  interface Props {
    groups: { group: string; entries: RenderedEntry[] }[];
    date: string;
    ratings: Record<string, string | null>;
    onRate: (extractionId: string, eventType: string | null) => void;
    /** Every source that failed on the run; this picks out the news desks. */
    failures: IngestFailure[];
  }

  let { groups, date, ratings, onRate, failures }: Props = $props();

  /**
   * Said here as well as above the briefing. For a reader whose only news source this is, a
   * missing desk has to be visible where the news is read, or an empty home heading reads as a
   * quiet day in the city.
   */
  const missing = $derived(failures.filter(isNewsDesk));
</script>

{#if groups.length > 0 || missing.length > 0}
  <section id="news" tabindex="-1" class="flex flex-col gap-6 scroll-mt-[calc(var(--header-h)+3.5rem)]">
    <h2 class="text-lg font-semibold text-surface-50 border-b border-surface-700 pb-2">News</h2>

    {#if missing.length > 0}
      <p role="status" class="rounded-lg border border-warning-800 bg-warning-950 px-3 py-2 text-xs text-warning-400">
        {#if groups.length === 0}
          No news today: {missing.map(failureLabel).join(", ")} did not deliver, so this is a gap in the
          briefing, not a quiet day.
        {:else}
          Incomplete: {missing.map(failureLabel).join(", ")} did not deliver, so its part of the news is
          missing below.
        {/if}
      </p>
    {/if}

    {#each groups as group, index (group.group)}
      <div id="news-{index}" tabindex="-1" class="flex flex-col gap-3 scroll-mt-[calc(var(--header-h)+3.5rem)]">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-surface-300">{group.group}</h3>
        {#each group.entries as entry, entryIndex (entryIndex)}
          <ReportEntry {entry} {date} {ratings} {onRate} />
        {/each}
      </div>
    {/each}
  </section>
{/if}
