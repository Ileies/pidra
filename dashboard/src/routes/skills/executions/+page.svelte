<script lang="ts">
  import ShowMore from "#lib/components/ShowMore.svelte";
  import { Paged } from "#lib/ui/paged.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Disclosure from "#lib/components/Disclosure.svelte";
  import JsonBlock from "#lib/components/JsonBlock.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const pager = new Paged(20);
</script>

<Page title="Recent executions" size="app" class="flex flex-col gap-4">
  <a href="/skills" class="tap self-start text-sm text-primary-400 hover:text-primary-300">← Skills</a>
  <h1 class="text-xl font-bold text-surface-50">Recent executions</h1>

  {#if data.executions.length === 0}
    <EmptyState title="No skill executions yet." compact />
  {:else}
    <ul class="flex flex-col gap-2">
      {#each pager.slice(data.executions) as exec (exec.id)}
        <li class="rounded-lg border border-surface-800 bg-surface-900">
          <Disclosure chevron class="tap px-4 py-2.5 flex flex-wrap items-center gap-2 bg-transparent border-none">
            {#snippet header()}
              <span class="font-mono text-surface-100 text-sm break-all">{exec.skill_name}</span>
              <Badge tone={toneFor(exec.status)}>{displayLabel(exec.status)}</Badge>
              <span class="text-xs text-surface-400">{exec.triggered_by ?? "-"}</span>
              <span class="text-xs text-surface-400 ml-auto whitespace-nowrap">{fmtDateTimeShort(exec.created_at)}</span>
            {/snippet}
            <div class="border-t border-surface-800 px-4 py-3 bg-surface-950 rounded-b-lg">
              {#if exec.parameters && Object.keys(exec.parameters).length > 0}
                <JsonBlock value={exec.parameters} class="mb-2" />
              {/if}
              {#if exec.result}<p class="text-sm {exec.status === 'failed' ? 'text-error-400' : 'text-surface-200'} break-words">{exec.result}</p>{/if}
              <p class="text-xs text-surface-400 mt-2 break-all">{exec.run_date} · id {exec.id}</p>
            </div>
          </Disclosure>
        </li>
      {/each}
    </ul>
    <ShowMore {pager} total={data.executions.length} />
  {/if}
</Page>
