<script lang="ts">
  import type { PageData } from "./$types";
  export let data: PageData;

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  const STATUS_CLASS: Record<string, string> = {
    pending: "text-warning-400 bg-warning-950 border-warning-700",
    executed: "text-success-400 bg-success-950 border-success-700",
    failed: "text-error-400 bg-error-950 border-error-700",
    rejected: "text-surface-500 bg-surface-900 border-surface-700",
  };

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
</script>

<svelte:head>
  <title>PIDRA - Skills</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Skill Executions</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 max-w-4xl w-full mx-auto px-8 py-8 pb-16">
    {#if data.executions.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">No skill executions yet.</p>
    {:else}
      <div class="flex flex-col gap-3">
        {#each data.executions as exec}
          <div class="bg-surface-900 border border-surface-700 rounded-lg px-5 py-4">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="font-mono text-sm font-semibold text-surface-50">{exec.skill_name}</span>
              <span class="badge text-xs border {STATUS_CLASS[exec.status] ?? 'text-surface-400 bg-surface-900 border-surface-700'}">{exec.status}</span>
              {#if exec.triggered_by}
                <span class="text-xs text-surface-500">{exec.triggered_by}</span>
              {/if}
              <span class="text-xs text-surface-500 ml-auto">{fmtDate(exec.created_at)}</span>
              <span class="text-xs text-surface-600">{exec.run_date}</span>
            </div>

            {#if exec.parameters && Object.keys(exec.parameters).length > 0}
              <pre class="text-xs text-surface-400 bg-surface-950 rounded px-3 py-2 overflow-x-auto mb-2">{JSON.stringify(exec.parameters, null, 2)}</pre>
            {/if}

            {#if exec.result}
              <p class="text-sm {exec.status === 'failed' ? 'text-error-400' : 'text-surface-300'}">{exec.result}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>
