<script lang="ts">
  import { setPageContext } from "$lib/assistant/state.svelte";
  import Page from "$lib/components/Page.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import StatCard from "$lib/components/StatCard.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import { fmtDate, fmtNum } from "$lib/format";
  import { label as displayLabel } from "$lib/labels";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  $effect(() => {
    setPageContext({
      surface: "entities",
      route: `/entities/${data.entity.id}`,
      digest: [
        `Entity "${data.entity.name}"${data.entity.type ? ` (${data.entity.type})` : ""}:`,
        `${data.entity.mentionCount} mentions, status ${data.entity.status}, importance ${data.entity.importance}.`,
        `${data.relations.length} relations, ${data.appearances.length} recorded appearances.`,
        data.entity.locked ? "This row is locked by a correction." : "",
      ].filter(Boolean).join(" "),
      focus: [{ kind: "entity", id: data.entity.id, label: data.entity.name }],
    });
  });

  const STATUS_TONE = { active: "success", dormant: "muted", archived: "neutral" } as const;
  const IMPORTANCE_TONE = { high: "warning", medium: "neutral", normal: "neutral", low: "muted" } as const;

  /** Reads the same in both directions: "X competes with Y" and "Y competes with X" are one edge. */
  function relationPhrase(relation: PageData["relations"][number]): string {
    const verb = (relation.relationType ?? "relates to").replace(/_/g, " ");
    return relation.direction === "out" ? verb : `${verb} (incoming)`;
  }

  const confirmed = $derived(data.relations.filter((relation) => relation.confirmed).length);
</script>

<Page title={data.entity.name} size="app" class="flex flex-col gap-6">
  <div class="flex flex-col gap-2">
    <a href="/entities" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← Entities</a>

    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-bold text-surface-50 break-words">{data.entity.name}</h1>
      {#if data.entity.type}<Badge tone="primary">{data.entity.type}</Badge>{/if}
      <Badge tone={STATUS_TONE[data.entity.status as keyof typeof STATUS_TONE] ?? "muted"}>
        {displayLabel(data.entity.status)}
      </Badge>
      <Badge tone={IMPORTANCE_TONE[data.entity.importance as keyof typeof IMPORTANCE_TONE] ?? "neutral"}>
        {displayLabel(data.entity.importance)} importance
      </Badge>
      {#if data.entity.locked}
        <!-- A correction merged into this row and snapshotted the previous state; a re-seed
             leaves it alone. Worth showing, because it explains why a re-run will not change it. -->
        <Badge tone="warning" title="A revise_context correction owns the named fields on this row">Locked by a correction</Badge>
      {/if}
    </div>

    {#if data.entity.aliases.length > 0}
      <p class="text-xs text-surface-400">Also known as: {data.entity.aliases.join(", ")}</p>
    {/if}

    {#if data.entity.summary}
      <p class="text-sm text-surface-200 max-w-prose">{data.entity.summary}</p>
    {/if}
  </div>

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <StatCard label="Mentions" value={fmtNum(data.entity.mentionCount)} />
    <StatCard label="Domain" value={data.entity.domain ?? "-"} />
    <StatCard label="First seen" value={fmtDate(data.entity.firstSeen)} />
    <StatCard label="Last mentioned" value={fmtDate(data.entity.lastMentioned)} />
  </div>

  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-baseline gap-3">
      <h2 class="text-base font-semibold text-surface-50">Relations ({data.relations.length})</h2>
      {#if data.relations.length > 0}
        <span class="text-xs text-surface-400">{confirmed} confirmed</span>
      {/if}
    </div>

    {#if data.relations.length === 0}
      <EmptyState
        title="No relations recorded."
        hint="Edges come from entity extraction, and only at confidence 0.7 and above."
        compact
      />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each data.relations as relation (relation.id)}
          <li class="rounded-lg border border-surface-700 bg-surface-900 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="text-xs text-surface-400 shrink-0">{relationPhrase(relation)}</span>
            <a href="/entities/{relation.otherId}" class="text-sm text-surface-100 no-underline hover:text-primary-400 break-words">
              {relation.otherName}
            </a>
            {#if relation.otherType}<Badge tone="muted">{relation.otherType}</Badge>{/if}
            {#if relation.confidence != null}
              <span class="text-xs text-surface-400 tabular-nums ml-auto">confidence {relation.confidence.toFixed(2)}</span>
            {/if}
            {#if relation.confirmed}<Badge tone="success">Confirmed</Badge>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-base font-semibold text-surface-50">Timeline ({data.appearances.length})</h2>

    {#if data.appearances.length === 0}
      <EmptyState title="No recorded appearances." hint="Appearances are written per report day as the entity is mentioned." compact />
    {:else}
      <ol class="flex flex-col gap-2">
        {#each data.appearances as appearance (appearance.id)}
          <li class="rounded-lg border border-surface-800 bg-surface-900 px-4 py-2.5 flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              {#if appearance.reportDate && appearance.hasReport}
                <a href="/{appearance.reportDate}" class="text-sm text-surface-100 no-underline hover:text-primary-400 tabular-nums">
                  {fmtDate(appearance.reportDate)}
                </a>
              {:else}
                <span class="text-sm text-surface-300 tabular-nums">{fmtDate(appearance.reportDate)}</span>
                {#if appearance.reportDate}<span class="text-xs text-surface-400">(no report for that day)</span>{/if}
              {/if}
              {#if appearance.relevanceScore != null}
                <span class="text-xs text-surface-400 tabular-nums ml-auto">relevance {appearance.relevanceScore}</span>
              {/if}
            </div>
            {#if appearance.contextSnippet}
              <p class="text-xs text-surface-300 break-words">{appearance.contextSnippet}</p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</Page>
