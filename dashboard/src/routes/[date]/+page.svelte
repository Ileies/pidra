<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The report surface: the assistant can read this briefing and act on notes, todos, the
  // calendar or the long-term context, but never edit the report. Reports are final.
  $effect(() => {
    setPageContext({
      surface: "report",
      route: `/${data.date}`,
      digest: [
        `Tagesbriefing vom ${data.date}${data.date === data.today ? " (heute)" : ""}.`,
        data.report
          ? `${data.report.itemsIncluded ?? 0} von ${data.report.itemCount ?? 0} Items im Report, ${data.report.itemsFiltered ?? 0} gefiltert.`
          : "Für diesen Tag gibt es noch keinen Report.",
        data.pipelineRun ? `Letzter Lauf: ${data.pipelineRun.status}.` : "",
      ].filter(Boolean).join(" "),
    });
  });

  function fmtNum(n: number | null | undefined) {
    if (n == null) return "-";
    return n.toLocaleString("de-DE");
  }

  let triggering = $state(false);
</script>

<svelte:head>
  <title>PIDRA - {data.date}</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
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
      {#if data.report.webSearchesRun != null && data.report.webSearchesRun > 0}
        <span class="text-surface-700 select-none">·</span>
        <span class="flex items-baseline gap-1">
          <span class="font-semibold text-surface-50 tabular-nums">{data.report.webSearchesRun}</span>
          <span class="text-surface-500">web searches</span>
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

        {#if !triggering && !form?.triggered && data.pipelineRun?.status !== "running"}
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
            >
              {data.pipelineRun?.status === "failed" ? "Erneut versuchen" : "Pipeline jetzt starten"}
            </button>
          </form>
        {/if}
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
