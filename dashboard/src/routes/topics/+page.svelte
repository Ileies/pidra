<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import { focusFrom } from "$lib/assistant/pageContext";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fmtDate } from "$lib/format";
  import { label as displayLabel } from "$lib/labels";
  import type { TopicRow } from "./+page.server";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => {
    setPageContext({
      surface: "entities",
      route: "/topics",
      digest: `Active topics: ${data.topics.length} shown (${data.counts.active} active, ${data.counts.resolved} resolved). Filter: ${data.statusFilter}.`,
      focus: focusFrom(data.topics, "topic", (topic) => ({ id: topic.id, label: topic.headline })),
    });
  });

  const STATUS_TONE = {
    active: "success",
    dormant: "muted",
    resolved: "neutral",
  } as const;

  const FILTERS: [string, string][] = [
    ["active", "Active"],
    ["dormant", "Dormant"],
    ["resolved", "Resolved"],
    ["all", "All"],
  ];

  function count(key: string): number {
    return data.counts[key as keyof typeof data.counts] ?? 0;
  }

  /** The days a topic was live in, newest first, capped so a long-running story stays readable. */
  function days(topic: TopicRow) {
    return topic.days.slice(0, 14);
  }
</script>

<Page title="Topics" size="app" class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="text-xl font-bold text-surface-50">Active topics</h1>
    <p class="text-xs text-surface-400 max-w-prose">
      The running summaries behind story continuity. A topic here is why tomorrow's briefing can
      say "UPDATE:" and state only what is new, instead of re-explaining the background. Resolving
      one stops it carrying forward.
    </p>
  </div>

  {#if form?.error}
    <p class="text-error-400 text-sm">{form.error}</p>
  {/if}

  <form method="GET" class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      name="q"
      value={data.search}
      placeholder="Search headlines and summaries…"
      aria-label="Search topics"
      class="input-base flex-1 min-w-48"
    />
    <input type="hidden" name="status" value={data.statusFilter} />
    <button
      type="submit"
      class="tap px-4 py-1.5 rounded text-sm bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
    >Search</button>
  </form>

  <div class="flex flex-wrap items-center gap-1">
    {#each FILTERS as [value, filterLabel] (value)}
      <a
        href="/topics?status={value}{data.search ? `&q=${encodeURIComponent(data.search)}` : ''}"
        aria-current={data.statusFilter === value ? "true" : undefined}
        class="tap px-3 py-1 rounded text-xs border no-underline transition-colors
          {data.statusFilter === value
            ? 'bg-surface-700 border-surface-500 text-surface-50'
            : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200'}"
      >
        {filterLabel} <span class="opacity-70">{count(value)}</span>
      </a>
    {/each}
  </div>

  {#if data.topics.length === 0}
    <EmptyState
      title="No topics match."
      hint="Topics are created by Phase 6 from the briefing's <!--SYSTEM--> block, so the first ones appear after a pipeline run that finds a story worth carrying forward."
    />
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.topics as topic (topic.id)}
        <li class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-4 flex flex-col gap-3">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div class="min-w-0 flex flex-col gap-1.5">
              <h2 class="text-sm font-semibold text-surface-50 break-words">{topic.headline}</h2>
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{topic.domain}</Badge>
                <Badge tone={STATUS_TONE[topic.status as keyof typeof STATUS_TONE] ?? "muted"}>
                  {displayLabel(topic.status)}
                </Badge>
                <span class="text-xs text-surface-400 tabular-nums">
                  {topic.updateCount} {topic.updateCount === 1 ? "update" : "updates"}
                </span>
                <span class="text-xs text-surface-400">
                  {fmtDate(topic.firstSeen)} – {fmtDate(topic.lastUpdated)}
                </span>
              </div>
            </div>

            <form method="POST" action="?/setStatus" use:enhance class="shrink-0 flex gap-2">
              <input type="hidden" name="id" value={topic.id} />
              {#if topic.status === "resolved"}
                <button
                  type="submit"
                  name="status"
                  value="active"
                  class="tap px-3 py-1.5 rounded text-xs border border-success-600 text-success-400 hover:bg-success-950 cursor-pointer transition-colors"
                >Reopen</button>
              {:else}
                <button
                  type="submit"
                  name="status"
                  value="dormant"
                  class="tap px-3 py-1.5 rounded text-xs border border-surface-500 text-surface-300 hover:bg-surface-800 cursor-pointer transition-colors"
                >Archive</button>
                <button
                  type="submit"
                  name="status"
                  value="resolved"
                  class="tap px-3 py-1.5 rounded text-xs border border-surface-500 text-surface-300 hover:border-primary-700 hover:text-primary-300 cursor-pointer transition-colors"
                >Resolve</button>
              {/if}
            </form>
          </div>

          {#if topic.runningSummary}
            <p class="text-sm text-surface-200 whitespace-pre-wrap break-words">{topic.runningSummary}</p>
          {/if}

          {#if topic.sources.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each topic.sources.slice(0, 8) as source (source)}
                <Badge tone="muted">{source}</Badge>
              {/each}
            </div>
          {/if}

          {#if topic.days.length > 0}
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <!-- A range, not a record of appearances: nothing joins a topic to the reports it
                   was mentioned in, so this is the window it was live in, narrowed to days that
                   produced a report. -->
              <span class="text-surface-400">Live on:</span>
              {#each days(topic) as day (day)}
                <a
                  href="/{day}"
                  class="tap rounded border border-surface-700 bg-surface-950 px-2 py-0.5 text-surface-300 no-underline hover:border-primary-800 hover:text-primary-300 tabular-nums"
                >{day}</a>
              {/each}
              {#if topic.days.length > days(topic).length}
                <span class="text-surface-400">+{topic.days.length - days(topic).length} more</span>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Page>
