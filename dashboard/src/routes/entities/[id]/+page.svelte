<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDate, fmtNum } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { sync } from "#lib/offline/sync.js";
  import type { PageData, ActionData } from "./$types";

  let { data: pageData, form }: { data: PageData; form: ActionData } = $props();

  // The layout renders the first-sync state instead of this page while the mirror is empty, so
  // only the filled shape ever reaches the markup; this narrows the type to match.
  const data = $derived(pageData.mirrorEmpty ? null : pageData);

  // Watching is a correction, which is never queued offline: replayed later, a locking merge on a
  // row that moved meanwhile does lasting damage.
  const isOffline = $derived(offline.reachable === "offline");

  $effect(() => toastFormResult(form));

  $effect(() => {
    if (!data) return;
    setPageContext({
      surface: "entities",
      route: `/entities/${data.entity.id}`,
      digest: [
        `Entity "${data.entity.name}"${data.entity.type ? ` (${data.entity.type})` : ""}:`,
        `${data.entity.mentionCount} mentions, status ${data.entity.status}, importance ${data.entity.importance}.`,
        `${data.appearances.length} recorded appearance(s).`,
        data.entity.importance === "high" ? "Watched: eligible for the monitoring search slot." : "",
        data.entity.locked ? "This row is locked by a correction." : "",
      ].filter(Boolean).join(" "),
      focus: [{ kind: "entity", id: data.entity.id, label: data.entity.name }],
    });
  });

  const IMPORTANCE_TONE = { high: "warning", medium: "neutral", normal: "neutral", low: "muted" } as const;
</script>

{#if data}
<Page title={data.entity.name} size="app" class="flex flex-col gap-6">
  <div class="flex flex-col gap-2">
    <a href="/entities" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← Entities</a>

    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-xl font-bold text-surface-50 break-words">{data.entity.name}</h1>
      {#if data.entity.type}<Badge tone="primary">{data.entity.type}</Badge>{/if}
      <Badge tone={toneFor(data.entity.status)}>
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

      <!-- Watching sets importance = 'high' through the same correction path, which is what makes
           an entity eligible for the monitoring search slot (src/search/slots.ts). -->
      <form
        method="POST"
        action="?/watch"
        use:enhance={() => async ({ update, result }) => {
          await update();
          if (result.type === "success") await sync({ force: true });
        }}
        class="ml-auto"
      >
        <input type="hidden" name="name" value={data.entity.name} />
        <input type="hidden" name="watched" value={data.entity.importance === "high" ? "false" : "true"} />
        <button
          type="submit"
          disabled={isOffline}
          title={isOffline ? "Needs the connection" : undefined}
          class="tap px-3 py-1 rounded text-xs border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 {data.entity.importance === 'high'
            ? 'bg-warning-900 border-warning-700 text-warning-200 hover:bg-warning-800'
            : 'bg-surface-800 border-surface-700 text-surface-300 hover:bg-surface-700'}"
        >{data.entity.importance === "high" ? "Watching" : "Watch"}</button>
      </form>
    </div>

    {#if data.entity.aliases.length > 0}
      <p class="text-xs text-surface-400">Also known as: {data.entity.aliases.join(", ")}</p>
    {/if}

    {#if data.entity.summary}
      <p class="text-sm text-surface-200 max-w-prose">{data.entity.summary}</p>
    {/if}

    {#if isOffline}
      <p class="text-xs text-warning-400 max-w-prose">
        Watching needs the connection: it is recorded as a correction, and corrections are never
        queued offline.
      </p>
    {/if}
  </div>

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <StatCard label="Mentions" value={fmtNum(data.entity.mentionCount)} />
    <StatCard label="Domain" value={data.entity.domain ?? "-"} />
    <StatCard label="First seen" value={fmtDate(data.entity.firstSeen)} />
    <StatCard label="Last mentioned" value={fmtDate(data.entity.lastMentioned)} />
  </div>

  <section class="flex flex-col gap-3">
    <h2 class="text-base font-semibold text-surface-50">Timeline ({data.appearances.length})</h2>

    {#if data.appearances.length === 0}
      <EmptyState title="No recorded appearances." hint="Written for a report day when a cited item names this entity." compact />
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
{/if}
