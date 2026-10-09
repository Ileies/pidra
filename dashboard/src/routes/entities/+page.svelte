<script lang="ts">
  // `/entities`: mirrored (offline-capable) filterable DataTable (cards on phones) fed by `+page.ts`; status/type/query
  // filters live in the URL, rows link to `/entities/[id]`.
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDaysAgo } from "#lib/format.js";
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

  // See the note on `shownUrl` in notes/+page.svelte.
  const shownUrl = () => page.shallow?.url ?? page.url;

  let filter = $state<EntitiesFilter>(parseFilter(shownUrl().searchParams));

  let written = shownUrl().search;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  function writeUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      written = searchOf(filter);
      if (written === shownUrl().search) return;
      goto(`/entities${written}`, { shallow: true, replace: true, reset: false, state: {} });
    }, 250);
  }

  // A tap on a result inside the debounce window must not be overtaken by the pending URL write.
  beforeNavigate(({ to }) => {
    if (to?.url.pathname !== page.url.pathname) clearTimeout(urlTimer);
  });

  $effect(() => {
    const search = shownUrl().search;
    if (search !== written) {
      written = search;
      filter = parseFilter(shownUrl().searchParams);
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
    <div class="text-xs text-surface-400 mt-0.5 line-clamp-2 md:max-w-xs lg:max-w-sm 2xl:max-w-lg" title={entity.summary}>{entity.summary}</div>
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

  <!-- Cards below `md` so a phone never scrolls sideways; the full table from `md` up. -->
  <DataTable
    rows={shown}
    key={(entity) => entity.id}
    mode="cards"
    caption="Entity graph"
    emptyTitle="No entities match."
    emptyHint="Entities accumulate from the pipeline and from the Context Builder harvest."
    columns={[
      { key: "name", header: "Name", card: "title", cell: nameCell },
      { key: "type", header: "Type", card: "row", value: (e) => e.type ?? "-", class: "text-surface-300 whitespace-nowrap" },
      { key: "last", header: "Last mentioned", card: "row", value: (e) => fmtDaysAgo(e.lastMentioned), class: "text-surface-200 whitespace-nowrap" },
      { key: "mentions", header: "Mentions", align: "right", card: "row", value: (e) => String(e.mentionCount), class: "tabular-nums text-surface-200" },
      { key: "domain", header: "Domain", showAt: "sm", card: "row", value: (e) => e.domain ?? "-", class: "text-surface-400" },
      { key: "importance", header: "Importance", showAt: "md", card: "row", cell: importanceCell },
      { key: "status", header: "Status", card: "row", cell: statusCell },
    ] as Column<Entity>[]}
  />
</Page>
