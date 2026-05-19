<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  function fmt(date: string) {
    return new Date(date + "T12:00:00").toLocaleDateString("de-DE", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function fmtNum(n: number | null | undefined) {
    if (n == null) return "—";
    return n.toLocaleString("de-DE");
  }

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  let triggering = false;
</script>

<svelte:head>
  <title>PIDRA — {data.date}</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">{fmt(data.date)}</span>
    </div>
    <nav class="flex items-center gap-2">
      {#if data.prevDate}
        <a href="/{data.prevDate}" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← {data.prevDate}</a>
      {:else}
        <span class="{navBtn} border-surface-700 text-surface-200 opacity-30 cursor-default select-none">←</span>
      {/if}
      <a href="/{data.today}" class="{navBtn} border-primary-900 text-primary-400 hover:bg-surface-800">Heute</a>
      {#if data.nextDate}
        <a href="/{data.nextDate}" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">{data.nextDate} →</a>
      {:else}
        <span class="{navBtn} border-surface-700 text-surface-200 opacity-30 cursor-default select-none">→</span>
      {/if}
      <a href="/sources" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">Quellen</a>
      {#if data.hasPendingQuestions}
        <a href="/questions" class="{navBtn} border-warning-700 text-warning-400 hover:bg-surface-800 animate-pulse">⚠ Questions</a>
      {:else}
        <a href="/questions" class="{navBtn} border-surface-700 text-surface-500 hover:bg-surface-800">Questions</a>
      {/if}
    </nav>
  </header>

  {#if data.report}
    <div class="flex items-center gap-2 px-8 py-2.5 bg-surface-900 border-b border-surface-700 text-xs flex-wrap">
      <span class="flex items-baseline gap-1">
        <span class="font-semibold text-surface-50 tabular-nums">{fmtNum(data.report.itemCount)}</span>
        <span class="text-surface-500">ingested</span>
      </span>
      <span class="text-surface-700 select-none">·</span>
      <span class="flex items-baseline gap-1">
        <span class="font-semibold text-surface-50 tabular-nums">{fmtNum(data.report.itemsIncluded)}</span>
        <span class="text-surface-500">included</span>
      </span>
      <span class="text-surface-700 select-none">·</span>
      <span class="flex items-baseline gap-1">
        <span class="font-semibold text-surface-50 tabular-nums">{fmtNum(data.report.tokensIn)}</span>
        <span class="text-surface-500">tok in</span>
      </span>
      <span class="text-surface-700 select-none">·</span>
      <span class="flex items-baseline gap-1">
        <span class="font-semibold text-surface-50 tabular-nums">{fmtNum(data.report.tokensOut)}</span>
        <span class="text-surface-500">tok out</span>
      </span>
      {#if data.report.aiCalls != null}
        <span class="text-surface-700 select-none">·</span>
        <span class="flex items-baseline gap-1">
          <span class="font-semibold text-surface-50 tabular-nums">{data.report.aiCalls}</span>
          <span class="text-surface-500">AI calls</span>
        </span>
      {/if}
    </div>
  {/if}

  <main class="flex-1 max-w-4xl w-full mx-auto px-8 py-8 pb-16">
    {#if data.reportHtml}
      <div class="report-body">
        {@html data.reportHtml}
      </div>
    {:else}
      <div class="flex flex-col items-center gap-5 pt-20 text-center text-surface-500">
        {#if data.pipelineRun?.status === "running"}
          <p class="text-primary-400 text-sm">Pipeline läuft… Seite in einigen Minuten neu laden.</p>
        {:else if data.pipelineRun?.status === "failed"}
          <div class="w-full max-w-2xl border border-error-500/40 rounded-lg overflow-hidden text-left bg-error-950">
            <div class="flex items-center gap-3 px-4 py-3 flex-wrap border-b border-error-500/25">
              <span class="badge text-xs font-semibold uppercase tracking-wider text-error-500 bg-error-500/20 border border-error-500/40">Fehlgeschlagen</span>
              <span class="text-sm text-surface-200">
                Step: <strong class="text-surface-50 font-mono">{data.pipelineRun.failedStep ?? "unbekannt"}</strong>
              </span>
              {#if data.pipelineRun.durationMs != null}
                <span class="text-xs text-surface-500 ml-auto">nach {Math.round(data.pipelineRun.durationMs / 1000)}s</span>
              {/if}
            </div>

            {#each data.pipelineRun.stepErrors as attempt}
              <div class="px-4 py-3 border-b border-surface-700/60 last:border-b-0">
                <div class="flex items-center gap-2.5 mb-1">
                  <span class="badge text-xs font-semibold text-surface-500 bg-surface-950 border border-surface-700 tabular-nums">Versuch {attempt.attempt}/3</span>
                  <span class="text-xs text-surface-500 tabular-nums">
                    {new Date(attempt.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span class="text-xs text-surface-500 font-mono ml-auto">{attempt.step}</span>
                </div>
                <pre class="font-mono text-xs text-error-500 bg-error-950 rounded px-3 py-2 whitespace-pre-wrap break-words m-0">{attempt.error}</pre>
                {#if attempt.stack}
                  <details class="mt-1">
                    <summary class="text-xs text-surface-500 cursor-pointer select-none hover:text-surface-200">Stack trace</summary>
                    <pre class="font-mono text-xs text-surface-500 bg-surface-950 rounded px-3 py-2 mt-1 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{attempt.stack}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p>Kein Report für {data.date}.</p>
        {/if}

        <form
          method="POST"
          action="?/runPipeline"
          use:enhance={() => {
            triggering = true;
            return async ({ update }) => {
              await update();
              triggering = false;
            };
          }}
        >
          <button
            type="submit"
            class="px-6 py-2.5 bg-primary-900 border border-primary-400 text-primary-400 rounded-md text-sm cursor-pointer hover:bg-primary-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={triggering}
          >
            {triggering ? "Wird gestartet…" : data.pipelineRun?.status === "failed" ? "Erneut versuchen" : "Pipeline jetzt starten"}
          </button>
        </form>
        {#if form?.error}
          <p class="text-error-500 text-sm">{form.error}</p>
        {/if}
        {#if form?.triggered}
          <p class="text-success-500 text-sm">Pipeline gestartet. Seite in ~5 Min. neu laden.</p>
        {/if}
      </div>
    {/if}
  </main>
</div>
