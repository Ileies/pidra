<script lang="ts">
  import { tick } from "svelte";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Tabs from "#lib/components/Tabs.svelte";
  import DocSearch from "#lib/contextBuilder/DocSearch.svelte";
  import QuickLinks from "#lib/contextBuilder/QuickLinks.svelte";
  import RunControls from "#lib/contextBuilder/RunControls.svelte";
  import { useContextRun } from "#lib/contextBuilder/useContextRun.svelte.js";
  import { fmtDateTime, fmtNum } from "#lib/format.js";
  import { highlightHtml, withHeadingIds } from "#lib/searchHighlight.js";
  import { readStored, writeStored } from "#lib/storage.js";
  import { openAncestors } from "#lib/ui/details.js";
  import { useScrollSpy } from "#lib/ui/scrollSpy.svelte.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The harvest is never overwritten here: the assistant records corrections that outrank it.
  // Corrections themselves moved to their own route (see below) - it can grow arbitrarily long,
  // and stacking it into this page's context digest would tell the assistant nothing it cannot
  // already see from the count.
  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/context-builder",
      digest: [
        "Harvested long-term context.",
        `${data.counts.entities} entities, ${data.counts.contacts} contacts,`,
        `${data.corrections.length} active corrections (see /context-builder/corrections).`,
        data.doc ? "The context document exists." : "There is no context document yet.",
      ].join(" "),
    });
  });

  // The run controls are online-only (live state, and the bridge): disabled once the app knows it
  // is offline, with the reason, like the writes on /contacts and /topics.
  const run = useContextRun();

  // The document and the source summaries are tabs: stacked, reaching the summaries meant
  // scrolling past the whole (often huge) document first.
  type Tab = "document" | "summaries";
  let activeTab = $state<Tab>("document");

  const docTagged = $derived(data.doc ? withHeadingIds(data.doc.fullContextHtml) : null);
  const docHeadings = $derived(docTagged?.headings ?? []);
  const summarySections = $derived((data.doc?.sections ?? []).filter((section) => section.chars > 0));

  // Search highlights matches in both tabs' rendered HTML directly, so it works whichever tab is
  // open and needs no DOM-diffing to undo when the query changes.
  let searchQuery = $state("");
  const docHtml = $derived(highlightHtml(docTagged?.html ?? "", searchQuery));
  const summaryHtml = $derived(
    new Map(summarySections.map((section) => [section.key, highlightHtml(section.html, searchQuery)])),
  );
  let contentRoot = $state<HTMLElement | undefined>();

  function showTabOf(el: HTMLElement) {
    const tab = el.closest<HTMLElement>("[data-tab-panel]")?.dataset.tabPanel;
    if (tab === "document" || tab === "summaries") activeTab = tab;
  }

  const spy = useScrollSpy(() => [
    ...docHeadings.map((h) => h.id),
    ...summarySections.map((s) => `summary-${s.key}`),
  ]);

  function jumpTo(id: string, tab: Tab) {
    activeTab = tab;
    void tick().then(() => {
      const el = document.getElementById(id);
      if (!el) return;
      openAncestors(el);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Which source summaries are open, remembered across visits: re-collapsing four sections every
  // time you open this page is the kind of friction that is never worth reporting yet always
  // worth fixing.
  const EXPANDED_KEY = "cb-expanded-summaries";

  function loadExpanded(): Set<string> {
    try {
      const raw = readStored(EXPANDED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  }

  let expandedSummaries = $state<Set<string>>(loadExpanded());

  function setExpanded(key: string, open: boolean) {
    const next = new Set(expandedSummaries);
    if (open) next.add(key);
    else next.delete(key);
    expandedSummaries = next;
    writeStored(EXPANDED_KEY, JSON.stringify([...next]));
  }

  // Back to top: only once there is somewhere to go back from.
  let scrollY = $state(0);
  const showBackToTop = $derived(scrollY > 600);
</script>

<svelte:window bind:scrollY />

{#snippet statusBar()}
  <RunControls {run} />
{/snippet}

<Page title="Context Builder" size="app" bleed={statusBar} class="flex flex-col gap-4">
  <!-- A newer run exists but is not what is on screen. Shown above the document, not below it:
       the point is that the reader knows before reading which version they are looking at. -->
  {#if data.skipped.length > 0}
    <section class="max-w-read bg-warning-950 border border-warning-900 rounded-lg p-4 sm:p-5">
      <h2 class="text-warning-400 text-sm font-semibold mb-2">
        {data.skipped.length === 1 ? "A newer run is not shown" : `${data.skipped.length} newer runs are not shown`}
      </h2>
      <ul class="text-surface-200 text-sm flex flex-col gap-1">
        {#each data.skipped as run (run.startedAt)}
          <li>
            <span class="tabular-nums">{fmtDateTime(run.startedAt)}</span>
            <span class="text-surface-400">({run.mode})</span> {run.reason}
          </li>
        {/each}
      </ul>
      <p class="text-surface-300 text-sm mt-2">
        {data.doc
          ? "The document below is the newest complete one. Start an update run to fold the newer material into it."
          : "No complete document could be read at all, so the daily briefing is running without one."}
      </p>
    </section>
  {/if}

  <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:items-start xl:gap-6">
    <div class="flex flex-col gap-4 min-w-0" bind:this={contentRoot}>
    {#if data.doc}
      <DocSearch
        bind:query={searchQuery}
        root={contentRoot}
        content={[docHtml, summaryHtml]}
        onreveal={showTabOf}
      />

      <Tabs
        tabs={[{ key: "document", label: "Document" }, { key: "summaries", label: "Source summaries" }]}
        bind:value={activeTab}
        label="Context Builder content"
      />

      <div
        id="panel-document"
        data-tab-panel="document"
        role="tabpanel"
        aria-labelledby="tab-document"
        hidden={activeTab !== "document"}
        tabindex="0"
      >
        <p class="text-surface-400 text-xs mb-3">
          {fmtNum(data.doc.chars)} chars
          {#if data.doc.generatedAt}· built {fmtDateTime(data.doc.generatedAt)}{/if}
          · synthesised from {fmtNum(data.counts.indexed_email)} emails and {fmtNum(data.counts.indexed_keep)} Keep notes
        </p>
        <article class="report-body text-sm max-w-none">
          {@html docHtml}
        </article>
      </div>

      <div
        id="panel-summaries"
        data-tab-panel="summaries"
        role="tabpanel"
        aria-labelledby="tab-summaries"
        hidden={activeTab !== "summaries"}
        tabindex="0"
      >
        <div class="flex flex-col gap-3">
          {#each summarySections as section (section.key)}
            <details
              id="summary-{section.key}"
              class="cb-anchor border-b border-surface-800 pb-2 last:border-0"
              open={expandedSummaries.has(section.key)}
              ontoggle={(e) => setExpanded(section.key, e.currentTarget.open)}
            >
              <summary class="tap text-surface-200 text-sm flex items-baseline justify-between gap-3">
                <span>{section.title}</span>
                <span class="text-surface-400 text-xs tabular-nums shrink-0">{fmtNum(section.chars)} chars</span>
              </summary>
              <article class="report-body text-sm max-w-none mt-3">{@html summaryHtml.get(section.key) ?? ""}</article>
            </details>
          {/each}
          <p class="text-surface-400 text-xs break-all">
            {#if data.doc.path}
              Source file (legacy row): <code>{data.doc.path}</code>
            {:else}
              Source: stored on the run row
            {/if}
          </p>
        </div>
      </div>
    {:else}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
        <h2 class="text-surface-100 text-base font-semibold mb-1">Long-term context</h2>
        <p class="text-surface-300 text-sm">
          {#if data.docError}
            The last completed run recorded a document, but it could not be read:
            <code class="text-warning-400 break-all">{data.docError}</code>
          {:else if data.run}
            The last completed run recorded no document. Re-run to generate one.
          {:else}
            No completed run yet. Start one below to build the context document.
          {/if}
        </p>
      </section>
    {/if}
    </div>

    <QuickLinks headings={docHeadings} summaries={summarySections} activeId={spy.active} onjump={jumpTo} />
  </div>
</Page>

{#if showBackToTop}
  <button
    type="button"
    class="tap nav-btn nav-btn-idle bg-surface-900 shadow-lg fixed z-30 left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+var(--safe-b))] lg:bottom-[calc(1.5rem+var(--safe-b))] transition-opacity"
    onclick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    aria-label="Back to top"
  >↑ Top</button>
{/if}
