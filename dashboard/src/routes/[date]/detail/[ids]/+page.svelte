<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  let loading = false;

  // Track optimistic rating state per item (synced from server on load)
  let ratings: Record<string, string | null> = Object.fromEntries(data.items.map((i) => [i.id, i.rating ?? null]));

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

  const NOVELTY_CLASS: Record<string, string> = {
    new: "badge bg-success-950 text-success-500",
    continuation: "badge bg-warning-950 text-warning-500",
    repeat: "badge bg-surface-800 text-surface-500",
  };

  const URGENCY_CLASS: Record<string, string> = {
    critical: "text-error-500",
    high: "text-warning-500",
    normal: "text-surface-500",
    low: "text-surface-500",
  };
</script>

<svelte:head>
  <title>PIDRA — Detail {data.date}</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center gap-4 px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <a href="/{data.date}" class="text-sm text-primary-400 no-underline hover:underline">← {data.date}</a>
    <span class="text-sm text-surface-500">Quellen-Detail</span>
  </header>

  <main class="max-w-4xl w-full mx-auto px-8 py-8 pb-16 flex flex-col gap-8">
    <div class="flex flex-col gap-5">
      {#each data.items as item}
        <article class="bg-surface-900 border border-surface-700 rounded-lg px-6 py-5 flex flex-col gap-2.5">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="badge bg-primary-900 text-primary-400 font-semibold">{item.sourceName ?? item.sourceType}</span>
            {#if item.novelty}
              <span class={NOVELTY_CLASS[item.novelty] ?? "badge bg-surface-800 text-surface-500"}>
                {NOVELTY_LABEL[item.novelty] ?? item.novelty}
              </span>
            {/if}
            {#if item.extracted?.urgency}
              <span class="font-semibold text-xs uppercase tracking-wider {URGENCY_CLASS[item.extracted.urgency] ?? 'text-surface-500'}">
                {item.extracted.urgency}
              </span>
            {/if}
            <span class="text-surface-500 ml-auto">{fmtDate(item.receivedAt)}</span>
            {#if item.effectiveRelevance != null}
              <span class="text-surface-500 tabular-nums">Relevanz {item.effectiveRelevance.toFixed(1)}</span>
            {/if}
          </div>

          {#if item.extracted?.headline}
            <h2 class="text-base font-semibold text-surface-50 leading-snug">{item.extracted.headline}</h2>
          {/if}

          {#if item.extracted?.key_claim}
            <p class="text-surface-200 text-sm leading-relaxed">{item.extracted.key_claim}</p>
          {/if}

          {#if item.extracted?.action_required}
            <p class="text-sm text-surface-200"><strong class="text-surface-50">Aktion:</strong> {item.extracted.action_required}</p>
          {/if}

          {#if item.extracted?.deadline}
            <p class="text-sm text-surface-200"><strong class="text-surface-50">Deadline:</strong> {item.extracted.deadline}</p>
          {/if}

          {#if item.extracted?.topic_tags?.length}
            <div class="flex flex-wrap gap-1.5">
              {#each item.extracted.topic_tags as tag}
                <span class="badge bg-surface-950 border border-surface-700 text-surface-500">{tag}</span>
              {/each}
            </div>
          {/if}

          {#if item.extracted?.entities?.length}
            <div class="flex flex-wrap gap-1.5">
              {#each item.extracted.entities as entity}
                <span class="badge bg-surface-800 text-surface-500">{entity}</span>
              {/each}
            </div>
          {/if}

          {#if item.rawContent}
            <details class="mt-1">
              <summary class="text-xs text-surface-500 cursor-pointer select-none hover:text-surface-200">Original-Email anzeigen</summary>
              <pre class="mt-3 text-xs whitespace-pre-wrap break-words text-surface-500 max-h-96 overflow-y-auto bg-surface-950 border border-surface-700 rounded px-4 py-3 leading-relaxed">{item.rawContent}</pre>
            </details>
          {/if}

          <div class="flex items-center gap-2 pt-1 border-t border-surface-800 mt-1">
            <span class="text-xs text-surface-600">Relevanz-Signal:</span>
            {#each [["1", "+", "success"] as const, ["-1", "−", "error"] as const] as [signal, label, color]}
              <form
                method="POST"
                action="?/rate"
                use:enhance={({ formData }) => {
                  const id = formData.get("extraction_id") as string;
                  const sig = formData.get("signal") as string;
                  const et = sig === "1" ? "explicit_plus" : "explicit_minus";
                  ratings[id] = ratings[id] === et ? null : et;
                  return async ({ update }) => update({ reset: false });
                }}
              >
                <input type="hidden" name="extraction_id" value={item.id} />
                <input type="hidden" name="signal" value={signal} />
                <button
                  type="submit"
                  class="w-7 h-7 rounded text-sm font-bold transition-colors border
                    {ratings[item.id] === (signal === '1' ? 'explicit_plus' : 'explicit_minus')
                      ? color === 'success' ? 'bg-success-700 border-success-500 text-white' : 'bg-error-700 border-error-500 text-white'
                      : 'bg-surface-800 border-surface-700 text-surface-400 hover:border-surface-500'}"
                  title={signal === "1" ? "Relevant — war gut" : "Nicht relevant"}
                >{label}</button>
              </form>
            {/each}
          </div>
        </article>
      {/each}
    </div>

    <section class="border-t border-surface-700 pt-6 flex flex-col gap-3">
      <h3 class="text-base font-semibold text-surface-50">Tiefer eintauchen</h3>
      <p class="text-sm text-surface-500">
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
        <button
          type="submit"
          class="px-5 py-2 bg-primary-900 border border-primary-400 text-primary-400 rounded-md text-sm cursor-pointer hover:bg-primary-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          disabled={loading}
        >
          {loading ? "Wird analysiert…" : "Zusammenfassen & vertiefen"}
        </button>
      </form>

      {#if form?.error}
        <p class="text-error-500 text-sm">{form.error}</p>
      {/if}

      {#if form?.deepDiveHtml}
        <div class="report-body mt-2 bg-surface-900 border border-surface-700 rounded-lg px-6 py-5">
          {@html form.deepDiveHtml}
        </div>
      {/if}
    </section>
  </main>
</div>
