<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData } from "./$types";

  export let data: PageData;

  function scoreColor(score: number | null): string {
    if (score == null) return "#555";
    if (score >= 7.5) return "#4caf50";
    if (score >= 5) return "#f9a825";
    return "#e53935";
  }

  function fmtScore(score: number | null): string {
    if (score == null) return "—";
    return score.toFixed(1);
  }

  function fmtPct(v: number | null): string {
    if (v == null) return "—";
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
  <title>PIDRA — Quellen</title>
</svelte:head>

<div class="shell">
  <header>
    <div class="header-left">
      <a href="/" class="logo">PIDRA</a>
      <span class="page-title">Quellenbewertung</span>
    </div>
    <nav>
      <a href="/" class="nav-btn today">← Heute</a>
    </nav>
  </header>

  <main>
    <p class="hint">
      Score 0–10 (gewichteter Durchschnitt der letzten 30 Tage). Formel: Relevanz × 7 + Aufnahme­quote × 3.
      Eine Quelle deaktivieren schließt sie ab dem nächsten Pipeline-Lauf aus der Extraktion aus.
    </p>

    <table class="sources-table">
      <thead>
        <tr>
          <th class="col-name">Newsletter</th>
          <th class="col-score">Score 30d</th>
          <th class="col-sparkline">Verlauf</th>
          <th class="col-rate">Aufnahme­quote</th>
          <th class="col-trend">Trend</th>
          <th class="col-action"></th>
        </tr>
      </thead>
      <tbody>
        {#each data.sources as src}
          <tr class:disabled={!src.isActive}>
            <td class="col-name">
              <span class="source-name">{src.sourceName}</span>
              {#if !src.isActive}
                <span class="badge-disabled">deaktiviert</span>
              {/if}
            </td>
            <td class="col-score">
              <span class="score-pill" style="color: {scoreColor(src.compositeScore30d)}">
                {fmtScore(src.compositeScore30d)}<span class="score-denom">/10</span>
              </span>
            </td>
            <td class="col-sparkline">
              {#if src.dailyScores.length > 0}
                <svg class="spark" viewBox="0 0 80 24" preserveAspectRatio="none">
                  {#each src.dailyScores.slice().reverse() as day, i}
                    {@const x = (i / Math.max(src.dailyScores.length - 1, 1)) * 78 + 1}
                    {@const y = 23 - ((day.compositeScore ?? 0) / 10) * 22}
                    <circle cx={x} cy={y} r="1.5" fill={scoreColor(day.compositeScore)} />
                  {/each}
                </svg>
              {:else}
                <span class="no-data">keine Daten</span>
              {/if}
            </td>
            <td class="col-rate">
              {#if src.dailyScores.length > 0}
                {@const avgRate = src.dailyScores.reduce((s, d) => s + (d.includeRate ?? 0), 0) / src.dailyScores.length}
                {fmtPct(avgRate)}
              {:else}
                —
              {/if}
            </td>
            <td class="col-trend">{trendLabel(src.qualityTrend)}</td>
            <td class="col-action">
              {#if src.isActive}
                {#if confirmDisable === src.sourceName}
                  <div class="confirm-row">
                    <input
                      type="text"
                      placeholder="Grund (optional)"
                      bind:value={disableReason}
                      class="reason-input"
                    />
                    <form method="POST" action="?/toggle" use:enhance>
                      <input type="hidden" name="sourceName" value={src.sourceName} />
                      <input type="hidden" name="isActive" value="false" />
                      <input type="hidden" name="reason" value={disableReason} />
                      <button type="submit" class="btn-danger">Bestätigen</button>
                    </form>
                    <button class="btn-cancel" on:click={() => { confirmDisable = null; disableReason = ""; }}>
                      Abbrechen
                    </button>
                  </div>
                {:else}
                  <button class="btn-disable" on:click={() => { confirmDisable = src.sourceName; disableReason = ""; }}>
                    Deaktivieren
                  </button>
                {/if}
              {:else}
                <form method="POST" action="?/toggle" use:enhance>
                  <input type="hidden" name="sourceName" value={src.sourceName} />
                  <input type="hidden" name="isActive" value="true" />
                  <button type="submit" class="btn-enable">Aktivieren</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
        {#if data.sources.length === 0}
          <tr>
            <td colspan="6" class="empty-row">Noch keine Quelldaten — läuft nach dem ersten Pipeline-Run.</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </main>
</div>

<style>
  .shell {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 1.5rem 4rem;
    font-family: "Berkeley Mono", "Fira Code", "Courier New", monospace;
    color: #e0e0e0;
    background: #0d0d0d;
    min-height: 100vh;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 0 1rem;
    border-bottom: 1px solid #222;
    margin-bottom: 1.5rem;
  }

  .header-left { display: flex; align-items: center; gap: 1rem; }

  .logo {
    font-size: 1.1rem;
    font-weight: 700;
    color: #e0e0e0;
    text-decoration: none;
    letter-spacing: 0.08em;
  }

  .page-title { color: #888; font-size: 0.9rem; }

  nav { display: flex; gap: 0.5rem; }

  .nav-btn {
    padding: 0.3rem 0.75rem;
    border: 1px solid #333;
    border-radius: 4px;
    color: #aaa;
    text-decoration: none;
    font-size: 0.82rem;
    background: transparent;
  }

  .nav-btn.today { color: #e0e0e0; border-color: #555; }

  .hint {
    font-size: 0.8rem;
    color: #666;
    margin-bottom: 1.5rem;
    line-height: 1.5;
  }

  .sources-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .sources-table th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: #666;
    font-weight: 400;
    border-bottom: 1px solid #222;
    white-space: nowrap;
  }

  .sources-table td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #181818;
    vertical-align: middle;
  }

  tr.disabled td { opacity: 0.45; }

  .source-name { color: #d0d0d0; }

  .badge-disabled {
    margin-left: 0.5rem;
    font-size: 0.7rem;
    background: #333;
    color: #888;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }

  .score-pill {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .score-denom { font-size: 0.75rem; color: #555; margin-left: 1px; }

  .spark { width: 80px; height: 24px; display: block; }

  .no-data { color: #444; font-size: 0.75rem; }

  .col-name { width: 30%; }
  .col-score { width: 10%; text-align: right; }
  .col-sparkline { width: 100px; }
  .col-rate { width: 10%; text-align: right; }
  .col-trend { width: 5%; text-align: center; color: #888; }
  .col-action { width: 200px; }

  .confirm-row { display: flex; align-items: center; gap: 0.5rem; }

  .reason-input {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    color: #d0d0d0;
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.25rem 0.5rem;
    width: 130px;
  }

  .btn-disable, .btn-enable, .btn-danger, .btn-cancel {
    padding: 0.25rem 0.65rem;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-disable {
    background: transparent;
    border-color: #444;
    color: #888;
  }
  .btn-disable:hover { border-color: #e53935; color: #e53935; }

  .btn-danger { background: #e53935; color: #fff; border-color: #e53935; }
  .btn-danger:hover { background: #c62828; }

  .btn-enable { background: transparent; border-color: #4caf50; color: #4caf50; }
  .btn-enable:hover { background: #1b5e20; }

  .btn-cancel { background: transparent; border-color: #333; color: #666; }
  .btn-cancel:hover { color: #aaa; }

  .empty-row { color: #555; text-align: center; padding: 2rem 0; }
</style>
