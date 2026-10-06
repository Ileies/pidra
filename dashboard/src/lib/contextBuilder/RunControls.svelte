<script lang="ts">
  /** The strip under the header: the run's status and the Start, Force full and Stop buttons. */
  import Badge from "#lib/components/Badge.svelte";
  import type { ContextRun } from "#lib/contextBuilder/useContextRun.svelte.js";
  import { fmtElapsed, fmtNum } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { offline } from "#lib/offline/state.svelte.js";

  let { run }: { run: ContextRun } = $props();
  const status = $derived(run.status);
</script>

<div class="bg-surface-900 border-b border-surface-700">
  <div class="mx-auto w-full max-w-app px-4 sm:px-6 lg:px-8 py-2 flex flex-col gap-2">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-3 flex-wrap">
        <Badge tone={toneFor(status?.dbRun?.status)}>
          {offline.isOffline ? "Offline" : displayLabel(status?.dbRun?.status ?? (status ? "idle" : "loading"))}
        </Badge>
        {#if status?.dbRun}
          <span class="text-surface-400 text-xs">{displayLabel(status.dbRun.mode)} mode</span>
          <span class="text-surface-400 text-xs tabular-nums">· {fmtElapsed(status.dbRun.started_at, status.dbRun.completed_at)} elapsed</span>
          <span class="text-surface-400 text-xs tabular-nums">· {fmtNum(status.dbRun.items_indexed)} items indexed</span>
        {:else if status}
          <span class="text-surface-400 text-xs">No runs yet.</span>
        {/if}
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="tap nav-btn border-primary-700 text-primary-300 hover:bg-surface-800"
          disabled={offline.isOffline || run.starting || status?.running}
          onclick={() => run.start(null)}
        >
          {run.starting ? "Starting…" : "Start"}
        </button>
        <button
          class="tap nav-btn nav-btn-muted"
          disabled={offline.isOffline || run.starting || status?.running}
          onclick={() => {
            // A full run re-reads the whole multi-year corpus through the model: millions of tokens.
            if (confirm("Force a full run? It re-extracts every email and note and costs millions of tokens.")) run.start("full");
          }}
        >
          Force full
        </button>
        <button
          class="tap nav-btn border-error-700 text-error-400 hover:bg-surface-800"
          disabled={offline.isOffline || run.stopping || !status?.trackedByDashboard}
          onclick={run.stop}
        >
          {run.stopping ? "Stopping…" : "Stop"}
        </button>
      </div>
    </div>
    {#if offline.isOffline}
      <!-- Live run state is what this strip shows, and a copy of it would be a lie. -->
      <p class="text-xs text-surface-400">Starting or stopping a run needs the connection. The status above is the last one seen.</p>
    {/if}
  </div>
</div>
