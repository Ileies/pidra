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

  let triggering = false;
</script>

<svelte:head>
  <title>PIDRA — {data.date}</title>
</svelte:head>

<div class="shell">
  <header>
    <div class="header-left">
      <span class="logo">PIDRA</span>
      <span class="date-label">{fmt(data.date)}</span>
    </div>
    <nav>
      {#if data.prevDate}
        <a href="/{data.prevDate}" class="nav-btn">← {data.prevDate}</a>
      {:else}
        <span class="nav-btn disabled">←</span>
      {/if}
      <a href="/{data.today}" class="nav-btn today">Heute</a>
      {#if data.nextDate}
        <a href="/{data.nextDate}" class="nav-btn">{data.nextDate} →</a>
      {:else}
        <span class="nav-btn disabled">→</span>
      {/if}
    </nav>
  </header>

  {#if data.report}
    <div class="stats-bar">
      <span class="stat">
        <span class="stat-val">{fmtNum(data.report.itemCount)}</span>
        <span class="stat-lbl">ingested</span>
      </span>
      <span class="sep">·</span>
      <span class="stat">
        <span class="stat-val">{fmtNum(data.report.itemsIncluded)}</span>
        <span class="stat-lbl">included</span>
      </span>
      <span class="sep">·</span>
      <span class="stat">
        <span class="stat-val">{fmtNum(data.report.tokensIn)}</span>
        <span class="stat-lbl">tok in</span>
      </span>
      <span class="sep">·</span>
      <span class="stat">
        <span class="stat-val">{fmtNum(data.report.tokensOut)}</span>
        <span class="stat-lbl">tok out</span>
      </span>
      {#if data.report.aiCalls != null}
        <span class="sep">·</span>
        <span class="stat">
          <span class="stat-val">{data.report.aiCalls}</span>
          <span class="stat-lbl">AI calls</span>
        </span>
      {/if}
    </div>
  {/if}

  <main>
    {#if data.reportHtml}
      <div class="report-body">
        {@html data.reportHtml}
      </div>
    {:else}
      <div class="empty">
        <p>Kein Report für {data.date}.</p>
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
          <button type="submit" class="run-btn" disabled={triggering}>
            {triggering ? "Wird gestartet…" : "Pipeline jetzt starten"}
          </button>
        </form>
        {#if form?.error}
          <p class="error-msg">{form.error}</p>
        {/if}
        {#if form?.triggered}
          <p class="success-msg">Pipeline gestartet. Seite in ~5 Min. neu laden.</p>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 2rem;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-left {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }

  .logo {
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.12em;
    color: var(--text-bright);
  }

  .date-label {
    color: var(--text-dim);
    font-size: 0.875rem;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .nav-btn {
    padding: 0.3rem 0.75rem;
    border-radius: 5px;
    font-size: 0.8rem;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .nav-btn:hover {
    background: var(--bg-hover);
    text-decoration: none;
  }

  .nav-btn.today {
    border-color: var(--accent-dim);
    color: var(--accent);
  }

  .nav-btn.disabled {
    opacity: 0.3;
    cursor: default;
  }

  .stats-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 2rem;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
  }

  .stat-val {
    font-weight: 600;
    color: var(--text-bright);
    font-variant-numeric: tabular-nums;
  }

  .stat-lbl {
    color: var(--text-dim);
  }

  .sep {
    color: var(--border);
    user-select: none;
  }

  main {
    flex: 1;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 2rem 4rem;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    padding-top: 5rem;
    text-align: center;
    color: var(--text-dim);
  }

  .run-btn {
    padding: 0.6rem 1.5rem;
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .run-btn:hover:not(:disabled) {
    background: #1e3a6e;
  }

  .run-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-msg {
    color: var(--red);
    font-size: 0.85rem;
  }

  .success-msg {
    color: var(--green);
    font-size: 0.85rem;
  }
</style>
