<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDate } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import type { MirroredEntity } from "#lib/offline/repo.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type Entity = MirroredEntity;

  /** What one view renders, as the server-rendered table did. */
  const SHOWN = 200;

  // --- filters: applied here so every keystroke re-renders live, no submit needed; kept in the
  // URL (debounced, no navigation) so a view is still shareable and survives a reload ---

  interface EntitiesFilter {
    status: string;
    type: string;
    query: string;
  }

  function parseFilter(params: Pick<URLSearchParams, "get">): EntitiesFilter {
    return {
      status: params.get("status") ?? "all",
      type: params.get("type") ?? "",
      query: params.get("q") ?? "",
    };
  }

  function searchOf(filter: EntitiesFilter): string {
    const params = new URLSearchParams();
    if (filter.status !== "all") params.set("status", filter.status);
    if (filter.type) params.set("type", filter.type);
    if (filter.query.trim()) params.set("q", filter.query.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  let filter = $state<EntitiesFilter>(parseFilter(page.url.searchParams));

  let written = page.url.search;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  function writeUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      written = searchOf(filter);
      if (written === page.url.search) return;
      goto(`/entities${written}`, { shallow: true, replace: true, reset: false, state: {} });
    }, 250);
  }

  $effect(() => {
    const search = page.url.search;
    if (search !== written) {
      written = search;
      filter = parseFilter(page.url.searchParams);
    }
  });

  function applyFilters(patch: Partial<EntitiesFilter>) {
    filter = { ...filter, ...patch };
    writeUrl();
  }

  const types = $derived([...new Set(data.entities.map((e) => e.type).filter((t): t is string => !!t))].sort());

  /** True when `needle` matches the name, an alias, or the summary - not just the canonical name. */
  function textMatches(entity: Entity, needle: string): boolean {
    if (needle === "") return true;
    if (entity.name.toLowerCase().includes(needle)) return true;
    if (entity.summary?.toLowerCase().includes(needle)) return true;
    return (entity.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
  }

  /** Whether `needle` hit an alias rather than the canonical name - shown so a match reads as
   *  "X, also known as the thing you typed" rather than looking unrelated to the search. */
  function matchedAlias(entity: Entity, needle: string): string | null {
    if (needle === "" || entity.name.toLowerCase().includes(needle)) return null;
    return (entity.aliases ?? []).find((alias) => alias.toLowerCase().includes(needle)) ?? null;
  }

  const matching = $derived.by(() => {
    const needle = filter.query.trim().toLowerCase();
    return data.entities.filter(
      (e) =>
        (filter.status === "all" || e.status === filter.status) &&
        (filter.type === "" || e.type === filter.type) &&
        textMatches(e, needle),
    );
  });
  const shown = $derived(matching.slice(0, SHOWN));

  // Entity rows are corrected through revise_context, not rewritten: the correction merges the
  // named fields and keeps a snapshot. The focus list carries the names the model needs.
  $effect(() => {
    setPageContext({
      surface: "entities",
      route: "/entities",
      digest: `Entity graph: ${shown.length} entities visible.`,
      focus: focusFrom(shown, "entity", (entity) => ({
        id: entity.id,
        label: `${entity.name}${entity.type ? ` (${entity.type})` : ""}`,
      })),
    });
  });

  const IMPORTANCE_CLASS: Record<string, string> = {
    high: "text-warning-400",
    medium: "text-surface-200",
    low: "text-surface-400",
  };
</script>

{#snippet nameCell(entity: Entity)}
  <a href="/entities/{entity.id}" class="font-medium text-surface-100 no-underline hover:text-primary-400 hover:underline">
    {entity.name}
  </a>
  {@const alias = matchedAlias(entity, filter.query.trim().toLowerCase())}
  {#if alias}
    <div class="text-xs text-primary-400 mt-0.5">matched alias "{alias}"</div>
  {:else if entity.aliases && entity.aliases.length > 0}
    <div class="text-xs text-surface-400 mt-0.5">{entity.aliases.slice(0, 3).join(", ")}</div>
  {/if}
  {#if entity.summary}
    <div class="text-xs text-surface-400 mt-0.5 max-w-xs lg:max-w-sm 2xl:max-w-lg truncate" title={entity.summary}>{entity.summary}</div>
  {/if}
{/snippet}

{#snippet statusCell(entity: Entity)}
  <Badge tone={toneFor(entity.status)}>
    {displayLabel(entity.status)}
  </Badge>
{/snippet}

{#snippet importanceCell(entity: Entity)}
  <span class="{IMPORTANCE_CLASS[entity.importance ?? ''] ?? 'text-surface-400'} text-xs">
    {displayLabel(entity.importance)}
  </span>
{/snippet}

<Page title="Entities" size="app" class="flex flex-col gap-4">
  <div class="flex flex-wrap gap-2">
    <input
      type="search"
      value={filter.query}
      oninput={(event) => applyFilters({ query: event.currentTarget.value })}
      placeholder="Search names, aliases, summaries…"
      aria-label="Search entities"
      class="input-base flex-1 min-w-48"
    />

    <select
      value={filter.status}
      onchange={(event) => applyFilters({ status: event.currentTarget.value })}
      aria-label="Status filter"
      class="input-base"
    >
      <option value="all">All statuses</option>
      <option value="active">Active</option>
      <option value="dormant">Dormant</option>
      <option value="archived">Archived</option>
    </select>

    {#if types.length > 0}
      <select
        value={filter.type}
        onchange={(event) => applyFilters({ type: event.currentTarget.value })}
        aria-label="Type filter"
        class="input-base"
      >
        <option value="">All types</option>
        {#each types as type (type)}
          <option value={type}>{type}</option>
        {/each}
      </select>
    {/if}
  </div>

  {#if matching.length > 0}
    <div class="text-xs text-surface-400">
      {matching.length > shown.length ? `The first ${shown.length} of ${matching.length} entities` : `${matching.length} entities`}
    </div>
  {/if}

  <!-- Scroll mode, not cards: this is a dense reference table where the grid is the
       information, and progressive columns already made it work on a phone (M-5). -->
  <DataTable
    rows={shown}
    key={(entity) => entity.id}
    mode="scroll"
    caption="Entity graph"
    emptyTitle="No entities match."
    emptyHint="Entities accumulate from the pipeline and from the Context Builder harvest."
    columns={[
      { key: "name", header: "Name", cell: nameCell },
      { key: "type", header: "Type", value: (e) => e.type ?? "-", class: "text-surface-300 whitespace-nowrap" },
      { key: "domain", header: "Domain", showAt: "sm", value: (e) => e.domain ?? "-", class: "text-surface-400" },
      { key: "mentions", header: "Mentions", align: "right", value: (e) => String(e.mentionCount), class: "tabular-nums text-surface-200" },
      { key: "status", header: "Status", cell: statusCell },
      { key: "importance", header: "Importance", showAt: "md", cell: importanceCell },
      { key: "last", header: "Last seen", align: "right", showAt: "lg", value: (e) => fmtDate(e.lastMentioned), class: "text-surface-400 text-xs whitespace-nowrap" },
    ] as Column<Entity>[]}
  />
</Page>
