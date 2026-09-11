<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  $effect(() => {
    setPageContext({
      surface: "sources",
      route: `/sources/${encodeURIComponent(data.sourceName)}`,
      digest: `Quellen-Detail "${data.sourceName}": ${data.quality?.is_active === false ? "deaktiviert" : "aktiv"}, Score ${
        data.quality?.composite_score_30d?.toFixed(1) ?? "-"
      }/10, ${data.stats.items} Beiträge aus ${data.stats.deliveries} Lieferungen, ${data.stats.emptyDeliveries} Lieferungen ohne Beitrag.`,
      focus: [{ kind: "source", id: data.sourceName }],
    });
  });

  let query = $state("");
  let onlyEmpty = $state(false);
  let confirmDisable = $state(false);
  let disableReason = $state("");

  const isActive = $derived(data.quality?.is_active !== false);

  /** An extraction row without a headline carried no content: skipped, or an empty result. */
  function isSkipped(item: PageData["deliveries"][number]["items"][number]): boolean {
    return !item.headline && !item.keyClaim;
  }

  const visible = $derived(
    data.deliveries.filter((delivery) => {
      if (onlyEmpty && delivery.items.some((item) => !isSkipped(item))) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const haystack = [
        delivery.title,
        delivery.sender,
        ...delivery.items.map((item) => `${item.headline ?? ""} ${item.keyClaim ?? ""} ${item.topicTags.join(" ")}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    }),
  );

  function scoreClass(score: number | null | undefined): string {
    if (score == null) return "text-surface-700";
    if (score >= 7.5) return "text-success-500";
    if (score >= 5) return "text-warning-500";
    return "text-error-500";
  }

  function relevanceClass(score: number | null): string {
    if (score == null) return "text-surface-700";
    if (score >= 4) return "text-success-500";
    if (score >= 3) return "text-warning-500";
    return "text-surface-500";
  }

  function fmtScore(score: number | null | undefined, digits = 1): string {
    return score == null ? "-" : score.toFixed(digits);
  }

  function fmtPct(v: number | null | undefined): string {
    return v == null ? "-" : Math.round(v * 100) + "%";
  }

  function fmtDate(s: string | null): string {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDay(s: string | null): string {
    if (!s) return "-";
    return new Date(s).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  }

  const TREND_LABEL: Record<string, string> = {
    improving: "↑ steigend",
    declining: "↓ fallend",
    stable: "→ stabil",
  };

  const NOVELTY_LABEL: Record<string, string> = {
    new: "Neu",
    continuation: "Fortsetzung",
    repeat: "Wiederholung",
  };

  const SKIP_LABEL: Record<string, string> = {
    promotional: "Werbung oder Automail",
  };

  function itemLabel(item: PageData["deliveries"][number]["items"][number]): string {
    if (item.headline) return item.headline;
    if (item.keyClaim) return item.keyClaim;
    if (item.skipReason) return `Übersprungen: ${SKIP_LABEL[item.skipReason] ?? item.skipReason}`;
    return "Übersprungen - kein Inhalt extrahiert";
  }

  const includeRate = $derived(data.stats.items > 0 ? data.stats.included / data.stats.items : null);
</script>

<svelte:head>
  <title>PIDRA - {data.sourceName}</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
  <main class="max-w-5xl mx-auto px-6 py-6 pb-16 w-full flex flex-col gap-6">
    <!-- Header: what the score is, and the one decision this page exists to support. -->
    <section class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h1 class="text-lg font-semibold text-surface-50">{data.sourceName}</h1>
          {#if !isActive}
            <span class="badge bg-surface-800 text-surface-500">deaktiviert</span>
          {/if}
        </div>
        <p class="text-xs text-surface-500">
          {data.stats.deliveries} Lieferungen, {data.stats.items} Beiträge
          {#if data.stats.firstSeen}
            · seit {fmtDay(data.stats.firstSeen)}
          {/if}
          {#if data.stats.lastSeen}
            · zuletzt {fmtDay(data.stats.lastSeen)}
          {/if}
        </p>
        {#if !isActive && data.quality?.disabled_reason}
          <p class="text-xs text-surface-500">
            Grund: <span class="text-surface-200">{data.quality.disabled_reason}</span>
            {#if data.quality.disabled_at}({fmtDay(data.quality.disabled_at)}){/if}
          </p>
        {/if}
      </div>

      <div class="flex items-center gap-4">
        <div class="text-right">
          <div class="text-2xl font-semibold tabular-nums {scoreClass(data.quality?.composite_score_30d)}">
            {fmtScore(data.quality?.composite_score_30d)}<span class="text-xs text-surface-700 ml-px">/10</span>
          </div>
          <div class="text-xs text-surface-500">{TREND_LABEL[data.quality?.quality_trend ?? "stable"] ?? "→"}</div>
        </div>

        {#if isActive}
          {#if confirmDisable}
            <div class="flex items-center gap-2">
              <input
                type="text"
                placeholder="Grund (optional)"
                bind:value={disableReason}
                class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-xs px-2 py-1 w-32"
              />
              <form method="POST" action="?/toggle" use:enhance={() => async ({ update }) => {
                confirmDisable = false;
                disableReason = "";
                await update();
              }}>
                <input type="hidden" name="isActive" value="false" />
                <input type="hidden" name="reason" value={disableReason} />
                <button type="submit" class="px-2.5 py-1 rounded text-xs cursor-pointer bg-error-500 text-white border border-error-500 hover:opacity-80 transition-opacity">Bestätigen</button>
              </form>
              <button
                class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-surface-700 text-surface-500 hover:text-surface-200 transition-colors"
                onclick={() => { confirmDisable = false; disableReason = ""; }}
              >
                Abbrechen
              </button>
            </div>
          {:else}
            <button
              class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-surface-700 text-surface-500 hover:border-error-500 hover:text-error-500 transition-colors"
              onclick={() => { confirmDisable = true; disableReason = ""; }}
            >
              Deaktivieren
            </button>
          {/if}
        {:else}
          <form method="POST" action="?/toggle" use:enhance>
            <input type="hidden" name="isActive" value="true" />
            <button type="submit" class="px-2.5 py-1 rounded text-xs cursor-pointer bg-transparent border border-success-500 text-success-500 hover:bg-success-950 transition-colors">Aktivieren</button>
          </form>
        {/if}
      </div>
    </section>

    <!-- The numbers behind the score, so it is checkable rather than just a verdict. -->
    <section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {#each [
        ["Aufnahmequote", fmtPct(includeRate), `${data.stats.included} von ${data.stats.items} Beiträgen`],
        ["⌀ Relevanz", fmtScore(data.stats.avgRelevance, 2), "Extraktion, 1–5"],
        ["⌀ effektiv", fmtScore(data.stats.avgEffectiveRelevance, 2), "nach Trust & Novelty"],
        ["Übersprungen", String(data.stats.skipped), "Werbung oder ohne Inhalt"],
        ["Ohne Extraktion", String(data.stats.emptyDeliveries), "Lieferungen ohne jeden Beitrag"],
        ["Bewertungen", `+${data.stats.plus} / −${data.stats.minus}`, "von mir vergeben"],
        ["Extraktionsfehler", String(data.stats.aiFailed), "AI-Call gescheitert"],
      ] as [label, value, hint]}
        <div class="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2.5">
          <div class="text-xs text-surface-500">{label}</div>
          <div class="text-base font-semibold text-surface-50 tabular-nums">{value}</div>
          <div class="text-[11px] text-surface-600 leading-tight mt-0.5">{hint}</div>
        </div>
      {/each}
    </section>

    {#if data.dailyScores.length > 0}
      <details class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3">
        <summary class="text-xs text-surface-500 cursor-pointer select-none hover:text-surface-200">
          Tageswerte der letzten 30 Tage ({data.dailyScores.length})
        </summary>
        <table class="w-full border-collapse text-xs mt-3">
          <thead>
            <tr>
              <th class="text-left px-2 py-1 text-surface-500 font-normal border-b border-surface-700">Tag</th>
              <th class="text-right px-2 py-1 text-surface-500 font-normal border-b border-surface-700">Erhalten</th>
              <th class="text-right px-2 py-1 text-surface-500 font-normal border-b border-surface-700">Aufgenommen</th>
              <th class="text-right px-2 py-1 text-surface-500 font-normal border-b border-surface-700">Quote</th>
              <th class="text-right px-2 py-1 text-surface-500 font-normal border-b border-surface-700">⌀ Relevanz</th>
              <th class="text-right px-2 py-1 text-surface-500 font-normal border-b border-surface-700">Score</th>
            </tr>
          </thead>
          <tbody>
            {#each data.dailyScores as day (day.runDate)}
              <tr>
                <td class="px-2 py-1 border-b border-surface-800 text-surface-200">{fmtDay(day.runDate)}</td>
                <td class="px-2 py-1 border-b border-surface-800 text-right tabular-nums">{day.itemsReceived}</td>
                <td class="px-2 py-1 border-b border-surface-800 text-right tabular-nums">{day.itemsIncluded}</td>
                <td class="px-2 py-1 border-b border-surface-800 text-right tabular-nums">{fmtPct(day.includeRate)}</td>
                <td class="px-2 py-1 border-b border-surface-800 text-right tabular-nums">{fmtScore(day.avgRelevance, 2)}</td>
                <td class="px-2 py-1 border-b border-surface-800 text-right tabular-nums {scoreClass(day.compositeScore)}">{fmtScore(day.compositeScore)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </details>
    {/if}

    <!-- The directory itself: every delivery and what extraction made of it. -->
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-base font-semibold text-surface-50">Beiträge</h2>
        <span class="text-xs text-surface-500">
          {visible.length} von {data.deliveries.length} Lieferungen
          {#if data.stats.deliveries > data.deliveries.length}
            (neueste {data.deliveryLimit} von {data.stats.deliveries})
          {/if}
        </span>
        <input
          type="search"
          placeholder="Filter: Titel, Headline, Tag…"
          bind:value={query}
          class="bg-surface-900 border border-surface-700 rounded text-surface-200 text-xs px-2 py-1 w-56 ml-auto"
        />
        <label class="flex items-center gap-1.5 text-xs text-surface-500 cursor-pointer select-none">
          <input type="checkbox" bind:checked={onlyEmpty} class="accent-primary-500" />
          nur ohne Beitrag
        </label>
      </div>

      {#each visible as delivery (delivery.rawItemId)}
        <article class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3 flex flex-col gap-2">
          <div class="flex flex-wrap items-baseline gap-2 text-xs">
            <span class="text-surface-200 font-medium flex-1 min-w-0 break-words">{delivery.title ?? "(ohne Titel)"}</span>
            <span class="text-surface-500 whitespace-nowrap">{fmtDate(delivery.receivedAt)}</span>
          </div>

          {#if delivery.sender}
            <p class="text-xs text-surface-600 break-all">Von: {delivery.sender}</p>
          {/if}

          {#if delivery.items.length === 0}
            <p class="text-xs text-surface-600">
              Keine Beiträge extrahiert - übersprungen (Werbung, Automail oder ohne Informationsgehalt).
            </p>
          {:else}
            <ul class="flex flex-col divide-y divide-surface-800 border-t border-surface-800 -mx-1">
              {#each delivery.items as item (item.id)}
                {@const skipped = isSkipped(item)}
                <li class="px-1 py-2 flex flex-col gap-1">
                  <div class="flex items-start gap-2">
                    <span class="text-sm font-semibold tabular-nums w-8 shrink-0 text-right {skipped ? 'text-surface-700' : relevanceClass(item.effectiveRelevance ?? item.relevanceScore)}">
                      {skipped ? "-" : fmtScore(item.effectiveRelevance ?? item.relevanceScore, 1)}
                    </span>
                    <div class="flex-1 min-w-0 flex flex-col gap-1">
                      <a
                        href="/{item.runDate ?? delivery.runDate}/detail/{item.id}"
                        class="text-sm leading-snug no-underline hover:text-primary-400 transition-colors {skipped ? 'text-surface-600 italic' : 'text-surface-200'}"
                      >
                        {itemLabel(item)}
                      </a>
                      <div class="flex flex-wrap items-center gap-1.5 text-xs">
                        {#if item.includedInReport}
                          <span class="badge bg-success-950 text-success-500">im Report</span>
                        {:else if !skipped}
                          <span class="badge bg-surface-800 text-surface-500">gefiltert</span>
                        {/if}
                        {#if item.novelty && item.novelty !== "new"}
                          <span class="badge bg-warning-950 text-warning-500">{NOVELTY_LABEL[item.novelty] ?? item.novelty}</span>
                        {/if}
                        {#if item.rating === "explicit_plus"}
                          <span class="badge bg-success-950 text-success-500">+</span>
                        {:else if item.rating === "explicit_minus"}
                          <span class="badge bg-error-950 text-error-500">−</span>
                        {/if}
                        {#if item.aiFailed}
                          <span class="badge bg-error-950 text-error-500">Extraktion gescheitert</span>
                        {/if}
                        {#each item.topicTags as tag}
                          <span class="badge bg-surface-950 border border-surface-700 text-surface-500">{tag}</span>
                        {/each}
                      </div>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </article>
      {/each}

      {#if data.deliveries.length === 0}
        <p class="text-surface-700 text-center py-8 text-sm">
          Von dieser Quelle ist noch nichts eingegangen.
        </p>
      {:else if visible.length === 0}
        <p class="text-surface-700 text-center py-8 text-sm">Keine Lieferung passt zum Filter.</p>
      {/if}
    </section>
  </main>
</div>
