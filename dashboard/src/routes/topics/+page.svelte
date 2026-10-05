<script lang="ts">
  // `/topics`: mirrored list of `active_topics` (status chips + GET search form, 20 per page via
  // `Paged`) from `+page.ts`. Resolve/archive posts the `setStatus` action in `+page.server.ts`.
  import ShowMore from "#lib/components/ShowMore.svelte";
  import { Paged } from "#lib/ui/paged.svelte.js";
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDate } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { page } from "$app/state";
  import { offline } from "#lib/offline/state.svelte.js";
  import { sync } from "#lib/offline/sync.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type TopicRow = PageData["topics"][number];

  const pager = new Paged(20);

  // Filtered here, from the URL the chips and the GET form write: the load
  // reads no URL, so a filter change re-renders this and never re-runs the load.
  const statusFilter = $derived(page.url.searchParams.get("status") ?? "active");
  const search = $derived(page.url.searchParams.get("q") ?? "");

  const STATUSES = [
    ["active", "Active"],
    ["dormant", "Dormant"],
    ["archived", "Archived"],
    ["resolved", "Resolved"],
  ] as const;

  const filters = $derived([
    ...STATUSES.map(([value, label]) => ({ value, label, count: data.topics.filter((t) => t.status === value).length })),
    { value: "all", label: "All", count: data.topics.length },
  ]);
  const countOf = $derived(Object.fromEntries(filters.map((f) => [f.value, f.count])));

  const filtered = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return data.topics.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (needle === "" ||
          t.headline.toLowerCase().includes(needle) ||
          (t.runningSummary ?? "").toLowerCase().includes(needle)),
    );
  });

  const shown = $derived(pager.slice(filtered));

  // Curation writes `active_topics` on the server, never through the outbox: it changes what
  // tomorrow's briefing carries forward.

  $effect(() => {
    setPageContext({
      surface: "entities",
      route: "/topics",
      digest: `Topics: ${shown.length} shown (${countOf.active} active, ${countOf.dormant} dormant, ${countOf.archived} archived, ${countOf.resolved} resolved). Filter: ${statusFilter}.`,
      focus: focusFrom(shown, "topic", (topic) => ({ id: topic.id, label: topic.headline })),
    });
  });

  /** The status changes a topic offers, by its current status. */
  const ACTIONS: { status: string; label: string; from: string[]; class: string }[] = [
    { status: "active", label: "Reactivate", from: ["resolved", "dormant", "archived"], class: "border-success-600 text-success-400 hover:bg-success-950" },
    { status: "archived", label: "Remove", from: ["active", "dormant"], class: "btn-ghost" },
    { status: "resolved", label: "Resolve", from: ["active", "dormant", "archived"], class: "btn-ghost" },
  ];

  /** The days a topic was live in, newest first, capped so a long-running story stays readable. */
  function days(topic: TopicRow) {
    return topic.days.slice(0, 14);
  }
</script>

<Page title="Topics" size="app" class="flex flex-col gap-4">
  {#if offline.isOffline}
    <p class="text-xs text-warning-400 max-w-prose">
      Resolving and archiving need the connection: they change what tomorrow's briefing carries
      forward, so they are never queued offline.
    </p>
  {/if}

  {#if form?.error}
    <p class="text-error-400 text-sm">{form.error}</p>
  {/if}

  <form method="GET" class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      name="q"
      value={search}
      placeholder="Search headlines and summaries…"
      aria-label="Search topics"
      class="input-base flex-1 min-w-48"
    />
    <input type="hidden" name="status" value={statusFilter} />
    <button
      type="submit"
      class="btn btn-md btn-solid"
    >Search</button>
  </form>

  <div class="flex flex-wrap items-center gap-1">
    {#each filters as filter (filter.value)}
      <a
        href="/topics?status={filter.value}{search ? `&q=${encodeURIComponent(search)}` : ''}"
        aria-current={statusFilter === filter.value ? "true" : undefined}
        class="tap px-3 py-1 rounded text-xs border no-underline transition-colors
          {statusFilter === filter.value
            ? 'bg-surface-700 border-surface-500 text-surface-50'
            : 'border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200'}"
      >
        {filter.label} <span class="opacity-70">{filter.count}</span>
      </a>
    {/each}
  </div>

  {#if shown.length === 0}
    <EmptyState
      title="No topics match."
      hint="Topics are created by Phase 6 from the briefing's <!--SYSTEM--> block, so the first ones appear after a pipeline run that finds a story worth carrying forward."
    />
  {:else}
    <ul class="flex flex-col gap-3">
      {#each shown as topic (topic.id)}
        <Card as="li" class="px-4 py-4 flex flex-col gap-3">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div class="min-w-0 flex flex-col gap-1.5">
              <h2 class="text-sm font-semibold text-surface-50 break-words">{topic.headline}</h2>
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{topic.domain}</Badge>
                <Badge tone={toneFor(topic.status)}>
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

            <!-- Written on the server, not through the outbox, so the offline copy this page reads
                 only shows it after a pull; forced, because the throttle would skip it. -->
            <form
              method="POST"
              action="?/setStatus"
              use:enhance={() => async ({ update, result }) => {
                await update();
                if (result.type === "success") await sync({ force: true });
              }}
              class="shrink-0 flex gap-2"
            >
              <input type="hidden" name="id" value={topic.id} />
              {#each ACTIONS.filter((a) => a.from.includes(topic.status)) as action (action.status)}
                <button
                  type="submit"
                  disabled={offline.isOffline}
                  name="status"
                  value={action.status}
                  class="btn btn-sm {action.class}"
                >{action.label}</button>
              {/each}
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
        </Card>
      {/each}
    </ul>
    <ShowMore {pager} total={filtered.length} />
  {/if}
</Page>
