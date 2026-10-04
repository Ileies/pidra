<script lang="ts">
  import { jsonInit } from "#lib/http.js";
  import { readStored, writeStored } from "#lib/storage.js";
  import { errMessage } from "$pipeline/util/text";
  import { onMount, onDestroy, tick } from "svelte";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatBar from "#lib/components/StatBar.svelte";
  import { fmtDateTime, fmtElapsed, fmtNum } from "#lib/format.js";
  import { label as displayLabel, toneFor } from "#lib/labels.js";
  import { toasts } from "#lib/toast.svelte.js";
  import type { ContextBuilderStatus } from "#lib/server/contextBuilder.js";
  import { netJson } from "#lib/offline/net.js";
  import { poll } from "#lib/offline/poll.js";
  import { sync } from "#lib/offline/sync.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // The run controls are online-only (live state, and the bridge): disabled once the app knows it
  // is offline, with the reason, like the writes on /contacts and /topics.
  const isOffline = $derived(offline.reachable === "offline");

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

  let status = $state<ContextBuilderStatus | null>(null);
  let starting = $state(false);
  let stopping = $state(false);
  let stopPoll: (() => void) | undefined;

  async function refresh() {
    try {
      const wasRunning = status?.running ?? false;
      status = await netJson<ContextBuilderStatus>("/api/context-builder/status");
      // A run that just finished wrote a new harvest, which this page reads from the offline copy.
      if (wasRunning && !status.running) void sync({ force: true });
    } catch {
      // transient - next poll will retry
    }
  }

  async function start(mode: "full" | "update" | null) {
    starting = true;
    try {
      const body = await netJson<{ ok: boolean; error?: string }>("/api/context-builder/start", jsonInit("POST", { mode }));
      if (body.ok) toasts.success(`Context Builder started${mode ? ` in ${mode} mode` : ""}.`);
      else toasts.error(body.error ?? "Failed to start.");
      await refresh();
    } catch (err) {
      toasts.error(errMessage(err));
    } finally {
      starting = false;
    }
  }

  async function stop() {
    stopping = true;
    try {
      const body = await netJson<{ ok: boolean; error?: string }>("/api/context-builder/stop", { method: "POST" });
      if (body.ok) toasts.show("Context Builder stopped.");
      else toasts.error(body.error ?? "Failed to stop.");
      await refresh();
    } catch (err) {
      toasts.error(errMessage(err));
    } finally {
      stopping = false;
    }
  }

  onMount(() => {
    stopPoll = poll(refresh, 2000, { immediate: true });
  });

  onDestroy(() => stopPoll?.());

  // --- Document + source summaries as tabs ------------------------------------------------------
  //
  // The old page stacked the document, then source summaries, so reaching the summaries meant
  // scrolling past the whole (often huge) document first. Tabs make them one click away.

  type Tab = "document" | "summaries";
  let activeTab = $state<Tab>("document");

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  interface DocHeading {
    id: string;
    title: string;
  }

  /** Tags each `<h1>` (the document's five contract-mandated sections, CLAUDE.md) with a scroll
   *  anchor, and reports what it found so Quick Links can list them - generically, rather than
   *  hardcoding the five titles here too, so a wording change on the pipeline side does not
   *  silently leave a stale Quick Links entry. */
  function withHeadingIds(html: string): { html: string; headings: DocHeading[] } {
    const headings: DocHeading[] = [];
    const tagged = html.replace(/<h1(\s[^>]*)?>([\s\S]*?)<\/h1>/g, (_m, attrs: string | undefined, inner: string) => {
      const title = inner.replace(/<[^>]+>/g, "").trim();
      const id = `doc-${slugify(title)}`;
      headings.push({ id, title });
      return `<h1${attrs ?? ""} id="${id}" class="cb-anchor">${inner}</h1>`;
    });
    return { html: tagged, headings };
  }

  const docTagged = $derived(data.doc ? withHeadingIds(data.doc.fullContextHtml) : null);
  const docHeadings = $derived(docTagged?.headings ?? []);
  const summarySections = $derived((data.doc?.sections ?? []).filter((section) => section.chars > 0));

  // --- In-page search: highlights matches in both tabs' rendered HTML directly, so it works
  // whichever tab is open and needs no DOM-diffing to undo when the query changes. ---------------

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Wraps matches in a `<mark>` without ever touching tag content: the input here is always
   *  already-sanitised HTML from `renderMarkdown()`, split on its own tags, and the replacement is
   *  the matched substring itself, so this can only ever add a wrapper around text that was
   *  already safe to render. */
  function highlightHtml(html: string, query: string): string {
    const q = query.trim();
    if (!q) return html;
    const re = new RegExp(escapeRegExp(q), "gi");
    return html
      .split(/(<[^>]+>)/g)
      .map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(re, (m) => `<mark class="search-hit">${m}</mark>`)))
      .join("");
  }

  let searchInput = $state("");
  let searchQuery = $state("");
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;

  function onSearchInput(value: string) {
    searchInput = value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => (searchQuery = value), 150);
  }

  function clearSearch() {
    clearTimeout(searchDebounce);
    searchInput = "";
    searchQuery = "";
  }

  const docHtml = $derived(highlightHtml(docTagged?.html ?? "", searchQuery));
  const summaryHtml = $derived(
    new Map(summarySections.map((section) => [section.key, highlightHtml(section.html, searchQuery)])),
  );

  let contentRoot = $state<HTMLElement | undefined>();
  let matches: HTMLElement[] = [];
  let matchIndex = $state(0);
  let matchCount = $state(0);

  function revealAndScroll(el: HTMLElement) {
    let details = el.closest("details");
    while (details) {
      details.open = true;
      details = details.parentElement?.closest("details") ?? null;
    }
    const panel = el.closest<HTMLElement>("[data-tab-panel]");
    if (panel?.dataset.tabPanel === "document" || panel?.dataset.tabPanel === "summaries") {
      activeTab = panel.dataset.tabPanel;
    }
    void tick().then(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  // Re-finds every match whenever the query (or the content it searches) changes. Cheaper than
  // diffing the previous highlight pass away: the highlighted HTML above is already a fresh
  // string each time, so there is nothing stale to undo.
  $effect(() => {
    const query = searchQuery;
    const root = contentRoot;
    void docHtml;
    void summaryHtml;
    if (!root) return;
    void tick().then(() => {
      const found = Array.from(root.querySelectorAll<HTMLElement>("mark.search-hit"));
      matches = found;
      matchCount = found.length;
      matchIndex = 0;
      found.forEach((m, i) => m.classList.toggle("search-hit-current", i === 0));
      if (query && found.length > 0) revealAndScroll(found[0]);
    });
  });

  function gotoMatch(delta: number) {
    if (matches.length === 0) return;
    matches[matchIndex]?.classList.remove("search-hit-current");
    matchIndex = (matchIndex + delta + matches.length) % matches.length;
    matches[matchIndex]?.classList.add("search-hit-current");
    const el = matches[matchIndex];
    if (el) revealAndScroll(el);
  }

  // --- Scrollspy: highlights whichever document heading or source summary is currently in view,
  // so the Quick Links rail doubles as a live "you are here". -----------------------------------

  let activeSectionId = $state<string | null>(null);

  $effect(() => {
    const ids = [...docHeadings.map((h) => h.id), ...summarySections.map((s) => `summary-${s.key}`)];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) activeSectionId = visible[0].target.id;
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  });

  function jumpTo(id: string, tab?: Tab) {
    if (tab) activeTab = tab;
    void tick().then(() => {
      const el = document.getElementById(id);
      if (!el) return;
      let details = el.closest("details");
      while (details) {
        details.open = true;
        details = details.parentElement?.closest("details") ?? null;
      }
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // --- Source summaries: which <details> are open, remembered across visits. A small thing, but
  // re-collapsing four sections every single time you open this page is the kind of friction
  // that is never worth reporting yet always worth fixing. ----------------------------------------

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

  // --- Back to top: only once there is somewhere to go back from. --------------------------------

  let showBackToTop = $state(false);

  $effect(() => {
    function onScroll() {
      showBackToTop = window.scrollY > 600;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  });
</script>

{#snippet statusBar()}
  <div class="bg-surface-900 border-b border-surface-700">
    <div class="mx-auto w-full max-w-app px-4 sm:px-6 lg:px-8 py-2 flex flex-col gap-2">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3 flex-wrap">
          <Badge tone={toneFor(status?.dbRun?.status)}>
            {isOffline ? "Offline" : displayLabel(status?.dbRun?.status ?? (status ? "idle" : "loading"))}
          </Badge>
          {#if status?.dbRun}
            <span class="text-surface-400 text-xs">{displayLabel(status.dbRun.mode)} mode</span>
            <span class="text-surface-400 text-xs tabular-nums">· {fmtElapsed(status.dbRun.started_at, status.dbRun.completed_at)} elapsed</span>
            <span class="text-surface-400 text-xs tabular-nums">· {fmtNum(status.dbRun.items_indexed)} items indexed</span>
          {:else if status}
            <span class="text-surface-400 text-xs">No runs yet.</span>
          {/if}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button
            class="tap nav-btn border-primary-700 text-primary-300 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={isOffline || starting || status?.running}
            onclick={() => start(null)}
          >
            {starting ? "Starting…" : "Start"}
          </button>
          <button
            class="tap nav-btn nav-btn-muted cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={isOffline || starting || status?.running}
            onclick={() => start("full")}
          >
            Force full
          </button>
          <button
            class="tap nav-btn border-error-700 text-error-400 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={isOffline || stopping || !status?.trackedByDashboard}
            onclick={stop}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>
      {#if isOffline}
        <!-- Live run state is what this strip shows, and a copy of it would be a lie. -->
        <p class="text-xs text-surface-400">Starting or stopping a run needs the connection. The status above is the last one seen.</p>
      {/if}
    </div>
  </div>
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
      <!-- Search reaches into both tabs at once: the highlighted HTML for a tab still renders
           fine while that tab is hidden, so a match in the tab you are not looking at is found
           immediately instead of only after you happen to switch there. -->
      <div class="bg-surface-900 border border-surface-700 rounded-lg p-2 flex items-center gap-2">
        <svg viewBox="0 0 24 24" class="size-4 text-surface-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          placeholder="Search the document and source summaries…"
          value={searchInput}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          class="flex-1 bg-transparent text-surface-100 text-sm placeholder:text-surface-500 outline-none min-w-0"
        />
        {#if searchQuery}
          <span class="text-surface-400 text-xs tabular-nums shrink-0" aria-live="polite">
            {matchCount > 0 ? `${matchIndex + 1} / ${matchCount}` : "No matches"}
          </span>
          <button type="button" class="tap nav-btn nav-btn-muted cursor-pointer shrink-0" disabled={matchCount === 0} onclick={() => gotoMatch(-1)} aria-label="Previous match">↑</button>
          <button type="button" class="tap nav-btn nav-btn-muted cursor-pointer shrink-0" disabled={matchCount === 0} onclick={() => gotoMatch(1)} aria-label="Next match">↓</button>
          <button type="button" class="tap nav-btn nav-btn-muted cursor-pointer shrink-0" onclick={clearSearch} aria-label="Clear search">✕</button>
        {/if}
      </div>

      <div role="tablist" aria-label="Context Builder content" class="flex gap-4 border-b border-surface-800">
        <button
          type="button"
          role="tab"
          id="tab-document"
          aria-selected={activeTab === "document"}
          aria-controls="panel-document"
          class="tap cursor-pointer pb-2 text-sm border-b-2 -mb-px transition-colors {activeTab === 'document' ? 'border-primary-500 text-surface-50 font-medium' : 'border-transparent text-surface-400 hover:text-surface-200'}"
          onclick={() => (activeTab = "document")}
        >Document</button>
        <button
          type="button"
          role="tab"
          id="tab-summaries"
          aria-selected={activeTab === "summaries"}
          aria-controls="panel-summaries"
          class="tap cursor-pointer pb-2 text-sm border-b-2 -mb-px transition-colors {activeTab === 'summaries' ? 'border-primary-500 text-surface-50 font-medium' : 'border-transparent text-surface-400 hover:text-surface-200'}"
          onclick={() => (activeTab = "summaries")}
        >Source summaries</button>
      </div>

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
              <summary class="tap cursor-pointer text-surface-200 text-sm flex items-baseline justify-between gap-3">
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

      <nav
        aria-label="Quick links"
        class="hidden xl:flex xl:flex-col gap-3 sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-var(--header-h)-2rem)] overflow-y-auto text-sm"
      >
        {#if docHeadings.length > 0}
          <div class="flex flex-col gap-0.5">
            <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Document</span>
            {#each docHeadings as heading (heading.id)}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer {activeSectionId === heading.id ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jumpTo(heading.id, "document")}
              >{heading.title}</button>
            {/each}
          </div>
        {/if}
        {#if summarySections.length > 0}
          <div class="flex flex-col gap-0.5">
            <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Source summaries</span>
            {#each summarySections as section (section.key)}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer flex items-baseline justify-between gap-2 {activeSectionId === `summary-${section.key}` ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jumpTo(`summary-${section.key}`, "summaries")}
              >
                <span>{section.title}</span>
                <span class="text-surface-500 tabular-nums shrink-0">{fmtNum(section.chars)}</span>
              </button>
            {/each}
          </div>
        {/if}
        <a
          href="/notes?scope=personal"
          class="tap px-2 py-1 text-xs text-primary-400 underline"
        >Standing rules</a>
        <a
          href="/context-builder/corrections"
          class="tap px-2 py-1 text-xs text-primary-400 underline"
        >Corrections</a>
      </nav>
  </div>
</Page>

{#if showBackToTop}
  <button
    type="button"
    class="tap nav-btn nav-btn-idle bg-surface-900 shadow-lg cursor-pointer fixed z-30 left-1/2 -translate-x-1/2 bottom-[calc(4.5rem+var(--safe-b))] lg:bottom-[calc(1.5rem+var(--safe-b))] transition-opacity"
    onclick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    aria-label="Back to top"
  >↑ Top</button>
{/if}
