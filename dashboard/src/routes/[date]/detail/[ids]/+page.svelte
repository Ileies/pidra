<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  let loading = false;

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const NOVELTY_LABEL: Record<string, string> = {
    new: "Neu",
    continuation: "Fortsetzung",
    repeat: "Wiederholung",
  };

  const URGENCY_COLOR: Record<string, string> = {
    critical: "var(--red)",
    high: "var(--yellow)",
    normal: "var(--text-dim)",
    low: "var(--text-dim)",
  };
</script>

<svelte:head>
  <title>PIDRA — Detail {data.date}</title>
</svelte:head>

<div class="shell">
  <header>
    <a href="/{data.date}" class="back-link">← {data.date}</a>
    <span class="header-title">Quellen-Detail</span>
  </header>

  <main>
    <div class="items-list">
      {#each data.items as item}
        <article class="item-card">
          <div class="item-meta">
            <span class="source-badge">{item.sourceName ?? item.sourceType}</span>
            {#if item.novelty}
              <span class="novelty-badge novelty-{item.novelty}">{NOVELTY_LABEL[item.novelty] ?? item.novelty}</span>
            {/if}
            {#if item.extracted?.urgency}
              <span class="urgency-badge" style="color:{URGENCY_COLOR[item.extracted.urgency] ?? 'var(--text-dim)'}">
                {item.extracted.urgency}
              </span>
            {/if}
            <span class="received-at">{fmtDate(item.receivedAt)}</span>
            {#if item.effectiveRelevance != null}
              <span class="relevance-val">Relevanz {item.effectiveRelevance.toFixed(1)}</span>
            {/if}
          </div>

          {#if item.extracted?.headline}
            <h2 class="item-headline">{item.extracted.headline}</h2>
          {/if}

          {#if item.extracted?.key_claim}
            <p class="item-claim">{item.extracted.key_claim}</p>
          {/if}

          {#if item.extracted?.action_required}
            <p class="item-action"><strong>Aktion:</strong> {item.extracted.action_required}</p>
          {/if}

          {#if item.extracted?.deadline}
            <p class="item-deadline"><strong>Deadline:</strong> {item.extracted.deadline}</p>
          {/if}

          {#if item.extracted?.topic_tags?.length}
            <div class="tags">
              {#each item.extracted.topic_tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}

          {#if item.extracted?.entities?.length}
            <div class="entities">
              {#each item.extracted.entities as entity}
                <span class="entity">{entity}</span>
              {/each}
            </div>
          {/if}

          {#if item.rawContent}
            <details class="raw-content">
              <summary>Original-Email anzeigen</summary>
              <pre>{item.rawContent}</pre>
            </details>
          {/if}
        </article>
      {/each}
    </div>

    <section class="deepen-section">
      <h3 class="deepen-title">Tiefer eintauchen</h3>
      <p class="deepen-desc">
        Lädt frische Web-Suchergebnisse und erstellt eine personalisierte Analyse — ohne Redundanz zum Report.
      </p>

      <form
        method="POST"
        action="?/zusammenfassen"
        use:enhance={() => {
          loading = true;
          return async ({ update }) => {
            await update();
            loading = false;
          };
        }}
      >
        <button type="submit" class="deepen-btn" disabled={loading}>
          {loading ? "Wird analysiert…" : "Zusammenfassen & vertiefen"}
        </button>
      </form>

      {#if form?.error}
        <p class="error-msg">{form.error}</p>
      {/if}

      {#if form?.deepDiveHtml}
        <div class="deep-dive report-body">
          {@html form.deepDiveHtml}
        </div>
      {/if}
    </section>
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
    gap: 1rem;
    padding: 0.75rem 2rem;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .back-link {
    font-size: 0.85rem;
    color: var(--accent);
  }

  .header-title {
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  main {
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 2rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .items-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .item-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
  }

  .source-badge {
    background: var(--accent-dim);
    color: var(--accent);
    border-radius: 4px;
    padding: 0.1rem 0.5rem;
    font-weight: 600;
  }

  .novelty-badge {
    border-radius: 4px;
    padding: 0.1rem 0.5rem;
  }

  .novelty-new { background: #1a3a1a; color: var(--green); }
  .novelty-continuation { background: #2a2a1a; color: var(--yellow); }
  .novelty-repeat { background: var(--bg); color: var(--text-dim); }

  .urgency-badge {
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .received-at {
    color: var(--text-dim);
    margin-left: auto;
  }

  .relevance-val {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .item-headline {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-bright);
    line-height: 1.4;
  }

  .item-claim {
    color: var(--text);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  .item-action, .item-deadline {
    font-size: 0.88rem;
    color: var(--text);
  }

  .item-action strong, .item-deadline strong {
    color: var(--text-bright);
  }

  .tags, .entities {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tag {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 3px;
    padding: 0.1rem 0.45rem;
    font-size: 0.75rem;
  }

  .entity {
    color: var(--text-dim);
    font-size: 0.78rem;
    padding: 0.1rem 0.4rem;
    background: #1a1f2a;
    border-radius: 3px;
  }

  .raw-content {
    margin-top: 0.25rem;
  }

  .raw-content summary {
    font-size: 0.8rem;
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
  }

  .raw-content summary:hover {
    color: var(--text);
  }

  .raw-content pre {
    margin-top: 0.75rem;
    font-size: 0.78rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-dim);
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.75rem 1rem;
    line-height: 1.5;
  }

  .deepen-section {
    border-top: 1px solid var(--border);
    padding-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .deepen-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-bright);
  }

  .deepen-desc {
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .deepen-btn {
    align-self: flex-start;
    padding: 0.55rem 1.25rem;
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .deepen-btn:hover:not(:disabled) {
    background: #1e3a6e;
  }

  .deepen-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-msg {
    color: var(--red);
    font-size: 0.85rem;
  }

  .deep-dive {
    margin-top: 0.5rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
  }
</style>
