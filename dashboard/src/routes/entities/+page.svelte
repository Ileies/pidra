<script lang="ts">
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import type { Column } from "#lib/components/table.js";
  import { fmtDate } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  type Entity = PageData["entities"][number];

  // Entity rows are corrected through revise_context, not rewritten: the correction merges the
  // named fields and keeps a snapshot. The focus list carries the names the model needs.
  $effect(() => {
    setPageContext({
      surface: "entities",
      route: "/entities",
      digest: `Entity graph: ${data.entities.length} entities visible.`,
      focus: focusFrom(data.entities, "entity", (entity) => ({
        id: entity.id,
        label: `${entity.name}${entity.type ? ` (${entity.type})` : ""}`,
      })),
    });
  });

  const STATUS_TONE = {
    active: "success",
    dormant: "muted",
    archived: "neutral",
  } as const;

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
  {#if entity.aliases && entity.aliases.length > 0}
    <div class="text-xs text-surface-400 mt-0.5">{entity.aliases.slice(0, 3).join(", ")}</div>
  {/if}
  {#if entity.summary}
    <div class="text-xs text-surface-400 mt-0.5 max-w-xs truncate" title={entity.summary}>{entity.summary}</div>
  {/if}
{/snippet}

{#snippet typeCell(entity: Entity)}
  <span class="text-surface-300 whitespace-nowrap">{entity.type ?? "-"}</span>
{/snippet}

{#snippet domainCell(entity: Entity)}
  <span class="text-surface-400">{entity.domain ?? "-"}</span>
{/snippet}

{#snippet mentionsCell(entity: Entity)}
  <span class="tabular-nums text-surface-200">{entity.mention_count ?? 0}</span>
{/snippet}

{#snippet statusCell(entity: Entity)}
  <Badge tone={STATUS_TONE[(entity.status ?? "") as keyof typeof STATUS_TONE] ?? "muted"}>
    {displayLabel(entity.status)}
  </Badge>
{/snippet}

{#snippet importanceCell(entity: Entity)}
  <span class="{IMPORTANCE_CLASS[entity.importance ?? ''] ?? 'text-surface-400'} text-xs">
    {displayLabel(entity.importance)}
  </span>
{/snippet}

{#snippet lastSeenCell(entity: Entity)}
  <span class="text-surface-400 text-xs whitespace-nowrap">{fmtDate(entity.last_mentioned)}</span>
{/snippet}

<Page title="Entities" size="app" class="flex flex-col gap-4">
  <form method="GET" class="flex flex-wrap gap-2">
    <input
      type="search"
      name="q"
      value={data.search}
      placeholder="Search entities…"
      aria-label="Search entities"
      class="input-base flex-1 min-w-48"
    />

    <select name="status" aria-label="Status filter" class="input-base">
      <option value="all" selected={data.statusFilter === "all"}>All statuses</option>
      <option value="active" selected={data.statusFilter === "active"}>Active</option>
      <option value="dormant" selected={data.statusFilter === "dormant"}>Dormant</option>
      <option value="archived" selected={data.statusFilter === "archived"}>Archived</option>
    </select>

    {#if data.types.length > 0}
      <select name="type" aria-label="Type filter" class="input-base">
        <option value="" selected={data.typeFilter === ""}>All types</option>
        {#each data.types as type (type)}
          <option value={type} selected={data.typeFilter === type}>{type}</option>
        {/each}
      </select>
    {/if}

    <button
      type="submit"
      class="tap px-4 py-1.5 rounded text-sm bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
    >Filter</button>
  </form>

  {#if data.entities.length > 0}
    <div class="text-xs text-surface-400">{data.entities.length} entities</div>
  {/if}

  <!-- Scroll mode, not cards: this is a dense reference table where the grid is the
       information, and progressive columns already made it work on a phone (M-5). -->
  <DataTable
    rows={data.entities}
    key={(entity) => entity.id}
    mode="scroll"
    caption="Entity graph"
    emptyTitle="No entities match."
    emptyHint="Entities accumulate from the pipeline and from the Context Builder harvest."
    columns={[
      { key: "name", header: "Name", cell: nameCell },
      { key: "type", header: "Type", cell: typeCell },
      { key: "domain", header: "Domain", showAt: "sm", cell: domainCell },
      { key: "mentions", header: "Mentions", align: "right", cell: mentionsCell },
      { key: "status", header: "Status", cell: statusCell },
      { key: "importance", header: "Importance", showAt: "md", cell: importanceCell },
      { key: "last", header: "Last seen", align: "right", showAt: "lg", cell: lastSeenCell },
    ] as Column<Entity>[]}
  />
</Page>
