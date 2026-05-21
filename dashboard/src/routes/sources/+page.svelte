<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData } from "./$types";

  export let data: PageData;

  function scoreClass(score: number | null): string {
    if (score == null) return "text-surface-700";
    if (score >= 7.5) return "text-success-500";
    if (score >= 5) return "text-warning-500";
    return "text-error-500";
  }

  function scoreColor(score: number | null): string {
    if (score == null) return "var(--color-surface-700)";
    if (score >= 7.5) return "var(--color-success-500)";
    if (score >= 5) return "var(--color-warning-500)";
    return "var(--color-error-500)";
  }

  function fmtScore(score: number | null): string {
    if (score == null) return "-";
    return score.toFixed(1);
  }

  function fmtPct(v: number | null): string {
    if (v == null) return "-";
    return Math.round(v * 100) + "%";
  }

  function trendLabel(trend: string | null): string {
    if (trend === "improving") return "↑";
    if (trend === "declining") return "↓";
    return "→";
  }

  let confirmDisable: string | null = null;
  let disableReason = "";
</script>

<svelte:head>
  <title>PIDRA - Quellen</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="sticky top-0 z-10 bg-surface-900 border-b border-surface-700">
    <div class="max-w-5xl mx-auto px-6 flex items-center justify-between py-3">
      <div class="flex items-center gap-4">
        <a href="/" class="font-bold tracking-widest text-surface-50 text-lg no-underline hover:underline">PIDRA</a>
        <span class="text-surface-500 text-sm">Quellenbewertung</span>
      </div>
      <nav>
        <a href="/" class="px-3 py-1 rounded border border-surface-700 text-surface-200 no-underline text-xs hover:bg-surface-800 transition-colors">← Heute</a>
      </nav>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-6 pb-16 w-full">
    <p class="text-xs text-surface-500 mb-6 leading-relaxed">
      Score 0–10 (gewichteter Durchschnitt der letzten 30 Tage). Formel: Relevanz × 7 + Aufnahme­quote × 3.
      Eine Quelle deaktivieren schließt sie ab dem nächsten Pipeline-Lauf aus der Extraktion aus.
    </p>

    <table class="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th class="text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Newsletter</th>
          <th class="text-right px-3 py-2 text-surface-500 font-normal border-b border-surface-700 whitespace-nowrap">Score 30d</th>
          <th class="w-24 text-left px-3 py-2 text-surface-500 font-normal border-b border-surface-700">Verlauf</th>
          <th class="text-right px-3 py-2 text-surface-500 font-normal border-b border-surface-700">Aufnahme­quote</th>
          <th class="text-center px-3 py-2 text-surface-500 font-normal border-b border-surface-700">Trend</th>
          <th class="w-48 px-3 py-2 border-b border-surface-700"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.sources as src}
          <tr class:opacity-50={!src.isActive}>
            <td class="px-3 py-2 border-b border-surface-800">
              <span class="text-surface-200">{src.sourceName}</span>
              {#if !src.isActive}
                <span class="badge ml-2 bg-surface-800 text-surface-500">deaktiviert</span>
              {/if}
            </td>
            <td class="px-3 py-2 border-b border-surface-800 text-right">
              <span class="text-base font-semibold tabular-nums {scoreClass(src.compositeScore30d)}">
                {fmtScore(src.compositeScore30d)}<span class="text-xs text-surface-700 ml-px">/10</span>
              </span>
            </td>
            <td class="px-3 py-2 border-b border-surface-800">
              {#if src.dailyScores.length > 0}
                <svg class="w-20 h-6 block" viewBox="0 0 80 24" preserveAspectRatio="none">
                  {#each src.dailyScores.slice().reverse() as day, i}
                    {@const x = (i / Math.max(src.dailyScores.length - 1, 1)) * 78 + 1}
                    {@const y = 23 - ((day.compositeScore ?? 0) / 10) * 22}
                    <circle cx={x} cy={y} r="1.5" fill={scoreColor(day.compositeScore)} />
                  {/each}
                </svg>
              {:else}
                <span class="text-surface-700 text-xs">keine Daten</span>
              {/if}
            </td>
            <td class="px-3 py-2 border-b border-surface-800 text-right">
              {#if src.dailyScores.length > 0}
                {@const avgRate = src.dailyScores.reduce((s, d) => s + (d.includeRate ?? 0), 0) / src.dailyScores.length}
                {fmtPct(avgRate)}
              {:else}
                -
              {/if}
            </td>
            <td class="px-3 py-2 border-b border-surface-800 text-center text-surface-500">{trendLabel(src.qualityTrend)}</td>
            <td class="px-3 py-2 border-b border-surface-800">
              {#if src.isActive}
                {#if confirmDisable === src.sourceName}
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Grund (optional)"
                      bind:value={disableReason}
                      class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-xs px-2 py-1 w-32"
                    />
                    <form method="POST" action="?/toggle" use:enhance>
                      <input type="hidden" name="sourceName" value={src.sourceName} />
                      <input type="hidden" name="isActive" value="false" />
                      <input type="hidden" name="reason" value={disableReason} />
                      <button type="submit" class="px-2.5 py-1 rounded text-xs cursor-pointer bg-error-500 text-white border border-error-500 hover:opacity-80 transition-opacity">Bestätigen</button>
                    </form>
                    <button
                      class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-surface-700 text-surface-500 hover:text-surface-200 transition-colors"
                      on:click={() => { confirmDisable = null; disableReason = ""; }}
                    >
                      Abbrechen
                    </button>
                  </div>
                {:else}
                  <button
                    class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-surface-700 text-surface-500 hover:border-error-500 hover:text-error-500 transition-colors"
                    on:click={() => { confirmDisable = src.sourceName; disableReason = ""; }}
                  >
                    Deaktivieren
                  </button>
                {/if}
              {:else}
                <form method="POST" action="?/toggle" use:enhance>
                  <input type="hidden" name="sourceName" value={src.sourceName} />
                  <input type="hidden" name="isActive" value="true" />
                  <button type="submit" class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-success-500 text-success-500 hover:bg-success-950 transition-colors">Aktivieren</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
        {#if data.sources.length === 0}
          <tr>
            <td colspan="6" class="text-surface-700 text-center py-8">Noch keine Quelldaten - läuft nach dem ersten Pipeline-Run.</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </main>
</div>
