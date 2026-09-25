<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import ExtractionCard from "#lib/report/ExtractionCard.svelte";
  import RateButtons from "#lib/report/RateButtons.svelte";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The deep dive is a model call through the skills bridge, so it is online-only (OFFLINE_PLAN.md
  // §1). Said up front rather than as a "Not sent" after the tap, like the other online-only writes.
  const isOffline = $derived(offline.reachable === "offline");

  $effect(() => toastFormResult(form));

  /**
   * The deep link behind a report entry. Since C5 the report expands these cards in place, so
   * this page is the shareable form and the no-JS fallback rather than the only way to see them.
   */

  // Still the report surface: these are the items behind a briefing paragraph, so they are read
  // material too. What the assistant can change from here are notes, todos and the context.
  $effect(() => {
    setPageContext({
      surface: "report",
      route: `/${data.date}/detail/${data.ids}`,
      digest: `Detail view for the ${data.date} briefing: ${data.items.length} item(s) from ${
        [...new Set(data.items.map((item) => item.sourceName).filter(Boolean))].join(", ") || "an unknown source"
      }.`,
    });
  });

  let loading = $state(false);

  // Optimistic, re-synced whenever the load function returns fresh rows.
  let ratings = $state<Record<string, string | null>>({});
  $effect(() => {
    ratings = Object.fromEntries(data.items.map((item) => [item.id, item.rating ?? null]));
  });

  function onRate(extractionId: string, eventType: string | null) {
    ratings[extractionId] = eventType;
  }
</script>

<Page title="Detail {data.date}" size="read" class="flex flex-col gap-8">
  <a href="/{data.date}" class="text-xs text-surface-400 hover:text-surface-200 no-underline">← {data.date}</a>

  <div class="flex flex-col gap-5">
    {#each data.items as item (item.id)}
      <div class="flex flex-col gap-2">
        <ExtractionCard {item} />
        <div class="flex items-center gap-2 pl-1">
          <span class="text-xs text-surface-400">Relevance signal:</span>
          <RateButtons extractionId={item.id} rating={ratings[item.id] ?? null} {onRate} />
        </div>
      </div>
    {/each}
  </div>

  <section class="border-t border-surface-700 pt-6 flex flex-col gap-3">
    <h2 class="text-base font-semibold text-surface-50">Go deeper</h2>
    <p class="text-sm text-surface-300">
      Fetches fresh web results and writes a personalised analysis, without repeating what the
      report already said.
    </p>

    <form
      method="POST"
      action="?/deepen"
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
        class="tap inline-flex items-center gap-2 px-5 py-2 bg-primary-900 border border-primary-600 text-primary-200 rounded-md text-sm cursor-pointer hover:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={loading || isOffline}
      >
        {#if loading}<Spinner label="Analysing" />{/if}
        {loading ? "Analysing…" : "Summarise and go deeper"}
      </button>
    </form>
    {#if isOffline}
      <p class="text-xs text-surface-400">Going deeper needs the connection.</p>
    {/if}

    {#if form?.deepDiveHtml}
      <div class="report-body mt-2 bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-6 py-5">
        {@html form.deepDiveHtml}
      </div>
    {/if}
  </section>
</Page>
