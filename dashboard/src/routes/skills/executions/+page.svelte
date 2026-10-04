<script lang="ts">
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let expandedExecs = $state<Record<string, boolean>>({});
  const EXECS_PAGE = 20;
  let visibleExecs = $state(EXECS_PAGE);

</script>

<Page title="Recent executions" size="app" class="flex flex-col gap-4">
  <a href="/skills" class="tap self-start text-sm text-primary-400 hover:text-primary-300">← Skills</a>
  <h1 class="text-xl font-bold text-surface-50">Recent executions</h1>

  {#if data.executions.length === 0}
    <EmptyState title="No skill executions yet." compact />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.executions.slice(0, visibleExecs) as exec (exec.id)}
        {@const open = !!expandedExecs[exec.id]}
        <li class="rounded-lg border border-surface-800 bg-surface-900">
          <button
            type="button"
            aria-expanded={open}
            onclick={() => (expandedExecs[exec.id] = !open)}
            class="tap w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-2 cursor-pointer bg-transparent border-none"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 shrink-0 text-surface-400 transition-transform {open ? 'rotate-90' : ''}" aria-hidden="true"><path d="M7 5l6 5-6 5V5z" /></svg>
            <span class="font-mono text-surface-100 text-sm break-all">{exec.skill_name}</span>
            <Badge tone={toneFor(exec.status)}>{displayLabel(exec.status)}</Badge>
            <span class="text-xs text-surface-400">{exec.triggered_by ?? "-"}</span>
            <span class="text-xs text-surface-400 ml-auto whitespace-nowrap">{fmtDateTimeShort(exec.created_at)}</span>
          </button>
          {#if open}
            <div class="border-t border-surface-800 px-4 py-3 bg-surface-950 rounded-b-lg">
              {#if exec.parameters && Object.keys(exec.parameters).length > 0}
                <pre class="text-xs text-surface-200 bg-surface-950 border border-surface-800 rounded px-3 py-2 overflow-x-auto mb-2">{JSON.stringify(exec.parameters, null, 2)}</pre>
              {/if}
              {#if exec.result}<p class="text-sm {exec.status === 'failed' ? 'text-error-400' : 'text-surface-200'} break-words">{exec.result}</p>{/if}
              <p class="text-xs text-surface-400 mt-2 break-all">{exec.run_date} · id {exec.id}</p>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if visibleExecs < data.executions.length}
      <button type="button" onclick={() => (visibleExecs += EXECS_PAGE)} class="tap self-start px-3 py-1.5 rounded text-xs border border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200 transition-colors cursor-pointer">Show more ({data.executions.length - visibleExecs} more)</button>
    {/if}
  {/if}
</Page>
