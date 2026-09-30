<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import { fmtCost, fmtDateTime, fmtElapsed, fmtNum } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
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
        `${data.counts.standing_context} standing rules, ${data.counts.entities} entities, ${data.counts.contacts} contacts,`,
        `${data.corrections.length} active corrections (see /context-builder/corrections).`,
        data.doc ? "The context document exists." : "There is no context document yet.",
      ].join(" "),
      focus: data.standing.slice(0, 30).map((rule) => ({
        kind: "standing_context",
        id: String(rule.key),
        label: String(rule.value ?? "").slice(0, 80),
      })),
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
      const body = await netJson<{ ok: boolean; error?: string }>("/api/context-builder/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (body.ok) toasts.success(`Context Builder started${mode ? ` in ${mode} mode` : ""}.`);
      else toasts.error(body.error ?? "Failed to start.");
      await refresh();
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
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
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      stopping = false;
    }
  }

  onMount(() => {
    stopPoll = poll(refresh, 2000, { immediate: true });
  });

  onDestroy(() => stopPoll?.());

  // The current run's window starts at the checkpoint's start, falling back to the DB run row.
  // Always with the date: errors.json spans every run ever made, and a time-only label made
  // failures from days-old abandoned runs read as the current run's.
  const runStartedAt = $derived(status?.checkpoint?.startedAt ?? status?.dbRun?.started_at ?? null);
  const currentErrors = $derived(
    runStartedAt
      ? (status?.errors ?? []).filter((error) => new Date(error.ts) >= new Date(runStartedAt))
      : (status?.errors ?? []),
  );
  const olderErrors = $derived(
    runStartedAt
      ? (status?.errors ?? []).filter((error) => new Date(error.ts) < new Date(runStartedAt))
      : [],
  );

  const STATUS_TONE = {
    running: "primary",
    completed: "success",
    failed: "error",
  } as const;

  const PHASES: { key: "email" | "tasks" | "keep" | "github"; label: string }[] = [
    { key: "email", label: "Email" },
    { key: "tasks", label: "Tasks" },
    { key: "keep", label: "Keep" },
    { key: "github", label: "GitHub" },
  ];

  // --- Document + source summaries as tabs, quick links, scrollspy, in-page search ---------
  //
  // The old page stacked the document, then source summaries, then a sidebar with everything
  // else - reaching source summaries meant scrolling past the whole (often huge) document first,
  // and there was no way to jump anywhere. Tabs make summaries one click away; Quick Links make
  // every section in either tab, plus the sidebar's own sections, one click away too.

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
    new Map((data.doc?.sections ?? []).map((section) => [section.key, highlightHtml(section.html, searchQuery)])),
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

  // --- Quick Links scrollspy: highlights whichever section is currently in view, in either tab
  // or the sidebar, so the panel doubles as a live "you are here" rather than a static list. -----

  let activeSectionId = $state<string | null>(null);

  $effect(() => {
    const ids = [
      ...docHeadings.map((h) => h.id),
      ...(data.doc?.sections.map((s) => `summary-${s.key}`) ?? []),
      "standing-rules",
      "errors-current",
    ];
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
      const raw = localStorage.getItem(EXPANDED_KEY);
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
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // private browsing / storage disabled - the toggle still works, it just will not persist
    }
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

{#snippet progress(name: string, done: boolean, detail: string, pct: number)}
  <div>
    <div class="flex items-center justify-between text-xs mb-1 gap-2">
      <span class="text-surface-200">{name}</span>
      <span class="text-surface-400 tabular-nums text-right">{detail}</span>
    </div>
    <div class="h-2 rounded-full bg-surface-800 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label={name}>
      <div class="h-full rounded-full transition-all duration-500 {done ? 'bg-success-500' : 'bg-primary-500'}" style="width: {pct}%"></div>
    </div>
  </div>
{/snippet}

<Page title="Context Builder" size="app" class="flex flex-col gap-6">
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

  <!-- Document on the left, everything dashboard-shaped in a sidebar that stays alongside it -
       the doc is often thousands of characters of prose, and making the reader scroll past all
       of it before reaching Start/Stop or the corrections list was the bug this replaced. -->
  <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-6">
    <!-- Main: what the builder actually produced. This is the point of the tool, so it leads.
         Not capped to the 68ch prose measure: a fixed-width column inside the wider `1fr` track
         left it stranded away from the sidebar with an ugly gap between them, so it fills the
         track up to the sidebar instead. -->
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

        <div role="tablist" aria-label="Context Builder content" class="flex gap-2">
          <button
            type="button"
            role="tab"
            id="tab-document"
            aria-selected={activeTab === "document"}
            aria-controls="panel-document"
            class="tap nav-btn cursor-pointer {activeTab === 'document' ? 'nav-btn-active' : 'nav-btn-idle'}"
            onclick={() => (activeTab = "document")}
          >Document</button>
          <button
            type="button"
            role="tab"
            id="tab-summaries"
            aria-selected={activeTab === "summaries"}
            aria-controls="panel-summaries"
            class="tap nav-btn cursor-pointer {activeTab === 'summaries' ? 'nav-btn-active' : 'nav-btn-idle'}"
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
          <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
            <div class="flex items-baseline justify-between flex-wrap gap-2 mb-1">
              <h2 class="text-surface-100 text-base font-semibold">Long-term context</h2>
              <span class="text-surface-400 text-xs tabular-nums">
                {fmtNum(data.doc.chars)} chars
                {#if data.doc.generatedAt}· built {fmtDateTime(data.doc.generatedAt)}{/if}
              </span>
            </div>
            <p class="text-surface-400 text-xs mb-4">
              Synthesised from {fmtNum(data.counts.indexed_email)} emails and
              {fmtNum(data.counts.indexed_keep)} Keep notes. Seeded
              {fmtNum(data.counts.contacts)} contacts, {fmtNum(data.counts.entities)} entities and
              {fmtNum(data.counts.standing_context)} standing rules.
            </p>
            <article class="report-body text-sm max-w-none">
              {@html docHtml}
            </article>
          </section>
        </div>

        <div
          id="panel-summaries"
          data-tab-panel="summaries"
          role="tabpanel"
          aria-labelledby="tab-summaries"
          hidden={activeTab !== "summaries"}
          tabindex="0"
        >
          <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5 flex flex-col gap-3">
            <h2 class="text-surface-200 text-sm font-semibold">Source summaries</h2>
            {#each data.doc.sections as section (section.key)}
              {#if section.chars > 0}
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
              {/if}
            {/each}
            <p class="text-surface-400 text-xs break-all">
              {#if data.doc.path}
                Source file (legacy row): <code>{data.doc.path}</code>
              {:else}
                Source: stored on the run row
              {/if}
            </p>
          </section>
        </div>
      {:else}
        <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
          <h2 class="text-surface-100 text-base font-semibold mb-1">Long-term context</h2>
          <p class="text-surface-300 text-sm">
            {#if data.docError}
              The last completed run recorded a document, but it could not be read:
              <code class="text-warning-400">{data.docError}</code>
            {:else if data.run}
              The last completed run recorded no document. Re-run to generate one.
            {:else}
              No completed run yet. Start one below to build the context document.
            {/if}
          </p>
        </section>
      {/if}
    </div>

    <!-- Sidebar. Run status/controls and Quick Links are both short and bounded (a handful of
         lines each, however big the document gets), so keeping them sticky together can never
         repeat last time's mistake. Standing rules and errors are unbounded, so they stay in
         plain flow below - one page, one scrollbar. Corrections moved off this page entirely:
         it is the one section here that can grow without limit, and cramming it into a sidebar
         slot is what made this page monstrous in the first place. -->
    <aside class="mt-6 xl:mt-0 flex flex-col gap-4">
      <div class="flex flex-col gap-4 xl:sticky" style="top: calc(var(--header-h) + 1.5rem)">
        <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
          <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div class="flex items-center gap-3">
              <Badge tone={STATUS_TONE[(status?.dbRun?.status ?? "") as keyof typeof STATUS_TONE] ?? "muted"}>
                {isOffline ? "Offline" : displayLabel(status?.dbRun?.status ?? (status ? "idle" : "loading"))}
              </Badge>
              {#if status?.dbRun}
                <span class="text-surface-400 text-sm">{displayLabel(status.dbRun.mode)} mode</span>
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
            <!-- Live run state is what this section shows, and a copy of it would be a lie. -->
            <p class="text-xs text-surface-400 mb-3">Starting or stopping a run needs the connection. The run status below is the last one seen.</p>
          {/if}

          {#if status?.dbRun}
            <div class="grid grid-cols-2 gap-3">
              <StatCard label="Elapsed" value={fmtElapsed(status.dbRun.started_at)} />
              <StatCard label="Items indexed" value={fmtNum(status.dbRun.items_indexed)} />
              <StatCard
                label="Memory (RSS)"
                value={status.trackedByDashboard && status.rssMb != null ? `${fmtNum(status.rssMb)} MB` : "not tracked"}
              />
              <!-- This figure used to be computed at Sonnet's $3/$15 per Mtok against gpt-5.6-luna
                   token counts, so it was simply wrong. It now comes from configured prices, and
                   says so when there are none rather than inventing a number. -->
              <StatCard
                label="OpenAI cost"
                value={status.checkpoint ? fmtCost(costUsd(status.checkpoint.openaiTokensIn, status.checkpoint.openaiTokensOut)) : "-"}
                hint={PRICING_CONFIGURED ? undefined : PRICING_HINT}
              />
            </div>
          {:else if status}
            <p class="text-surface-300 text-sm">No runs yet.</p>
          {/if}
        </section>

        <!-- Quick Links: every section in either tab, plus the sidebar's own sections, one click
             away. The entry for whatever is currently on screen highlights itself. -->
        <nav aria-label="Quick links" class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5 flex flex-col gap-3 text-sm">
          <h2 class="text-surface-200 text-sm font-semibold">Quick links</h2>

          {#if docHeadings.length > 0}
            <div class="flex flex-col gap-0.5">
              <span class="text-surface-500 text-xs uppercase tracking-wide">Document</span>
              {#each docHeadings as heading (heading.id)}
                <button
                  type="button"
                  class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer {activeSectionId === heading.id ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                  onclick={() => jumpTo(heading.id, "document")}
                >{heading.title}</button>
              {/each}
            </div>
          {/if}

          {#if data.doc}
            <div class="flex flex-col gap-0.5">
              <span class="text-surface-500 text-xs uppercase tracking-wide">Source summaries</span>
              {#each data.doc.sections as section (section.key)}
                {#if section.chars > 0}
                  <button
                    type="button"
                    class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer flex items-baseline justify-between gap-2 {activeSectionId === `summary-${section.key}` ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                    onclick={() => jumpTo(`summary-${section.key}`, "summaries")}
                  >
                    <span>{section.title}</span>
                    <span class="text-surface-500 tabular-nums shrink-0">{fmtNum(section.chars)}</span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}

          <div class="flex flex-col gap-0.5 border-t border-surface-800 pt-2">
            {#if data.standing.length > 0}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer {activeSectionId === 'standing-rules' ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jumpTo("standing-rules")}
              >Standing rules ({data.standing.length})</button>
            {/if}
            {#if currentErrors.length > 0}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer {activeSectionId === 'errors-current' ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jumpTo("errors-current")}
              >Errors this run ({currentErrors.length})</button>
            {/if}
            {#if olderErrors.length > 0}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer text-surface-300 hover:bg-surface-800"
                onclick={() => jumpTo("errors-older")}
              >Older errors ({olderErrors.length})</button>
            {/if}
            <a
              href="/context-builder/corrections"
              class="tap text-left px-2 py-1 rounded text-xs text-primary-400 hover:bg-surface-800 flex items-center justify-between no-underline"
            >
              <span>Corrections ({data.corrections.length})</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </nav>
      </div>

      <!-- Phase progress -->
      {#if status?.checkpoint}
        {@const checkpoint = status.checkpoint}
        <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5 flex flex-col gap-4">
          <h2 class="text-surface-200 text-sm font-semibold">Steps</h2>

          {#each PHASES as phase (phase.key)}
            {@const p = checkpoint.phases[phase.key]}
            {@const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : p.done ? 100 : 0}
            {@render progress(
              phase.label,
              p.done,
              p.done
                ? `done${p.skipped > 0 ? ` · ${fmtNum(p.skipped)} skipped` : ""}`
                : p.total > 0
                  ? `${fmtNum(p.processed)} / ${fmtNum(p.total)}${p.skipped > 0 ? ` · ${fmtNum(p.skipped)} skipped` : ""}`
                  : "waiting…",
              pct,
            )}
          {/each}

          {@render progress("Synthesis", checkpoint.phases.synthesis.done, checkpoint.phases.synthesis.done ? "done" : "waiting…", checkpoint.phases.synthesis.done ? 100 : 0)}
          {@render progress("DB seed", checkpoint.phases.dbSeed.done, checkpoint.phases.dbSeed.done ? "done" : "waiting…", checkpoint.phases.dbSeed.done ? 100 : 0)}
        </section>

        <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
          <h2 class="text-surface-200 text-sm font-semibold mb-3">Numbers</h2>
          <div class="grid grid-cols-2 gap-3">
            <StatCard label="Tokens in" value={fmtNum(checkpoint.openaiTokensIn)} />
            <StatCard label="Tokens out" value={fmtNum(checkpoint.openaiTokensOut)} />
            <StatCard label="Emails extracted" value={fmtNum(checkpoint.phases.email.processed)} />
            <StatCard label="Notes extracted" value={fmtNum(checkpoint.phases.keep.processed)} />
            <StatCard label="GitHub repos" value={fmtNum(checkpoint.phases.github.processed || checkpoint.phases.github.total)} />
            <StatCard
              label="Errors this run"
              value={fmtNum(currentErrors.length)}
              tone={currentErrors.length > 0 ? "warning" : "default"}
            />
          </div>
        </section>
      {/if}

      {#if data.standing.length > 0}
        <section id="standing-rules" class="cb-anchor bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
          <h2 class="text-surface-200 text-sm font-semibold mb-1">Standing rules ({data.standing.length})</h2>
          <p class="text-surface-400 text-xs mb-3">
            Persistent rules extracted from your Keep notes, stored in <code>standing_context</code>.
          </p>
          <ul class="flex flex-col gap-2 text-sm">
            {#each data.standing as rule (rule.key)}
              <li class="border-b border-surface-800 pb-2 last:border-0">
                <div class="text-surface-200 whitespace-pre-wrap break-words">{rule.value}</div>
                <div class="text-surface-400 text-xs mt-1 break-all"><code>{rule.key}</code> · {rule.source}</div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- errors.json is a persistent log across every run ever made, so it is split here by the
           current run's start time: showing the whole file undated made errors from runs abandoned
           days earlier look like the current run's output. -->
      {#if currentErrors.length > 0}
        <section id="errors-current" class="cb-anchor bg-surface-900 border border-warning-800 rounded-lg p-4 sm:p-5">
          <h2 class="text-warning-400 text-sm font-semibold mb-3">Errors this run ({currentErrors.length})</h2>
          <ul class="flex flex-col gap-2 text-xs">
            <!-- Keyed on index too: two errors.json entries can share a (ts, source) pair (seen in
                 production), and a duplicate key crashes Svelte's keyed each with no reported
                 exception. -->
            {#each currentErrors as error, i (`${error.ts}-${error.source}-${i}`)}
              <li class="border-b border-surface-800 pb-2 last:border-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <Badge tone="muted">{error.source}</Badge>
                  <span class="text-surface-400">{fmtDateTime(error.ts)}</span>
                </div>
                <div class="text-surface-300 mt-1 whitespace-pre-wrap break-words">{error.error}</div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if olderErrors.length > 0}
        <section id="errors-older" class="cb-anchor bg-surface-900 border border-surface-800 rounded-lg p-4 sm:p-5">
          <details>
            <summary class="tap text-surface-300 text-sm font-semibold cursor-pointer">
              Older errors from previous runs ({olderErrors.length})
            </summary>
            <ul class="flex flex-col gap-2 text-xs mt-3">
              {#each olderErrors as error, i (`${error.ts}-${error.source}-${i}`)}
                <li class="border-b border-surface-800 pb-2 last:border-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <Badge tone="muted">{error.source}</Badge>
                    <span class="text-surface-400">{fmtDateTime(error.ts)}</span>
                  </div>
                  <div class="text-surface-400 mt-1 whitespace-pre-wrap break-words">{error.error}</div>
                </li>
              {/each}
            </ul>
          </details>
        </section>
      {/if}
    </aside>
  </div>
</Page>

{#if showBackToTop}
  <button
    type="button"
    class="tap nav-btn nav-btn-idle bg-surface-900 shadow-lg cursor-pointer fixed z-40 right-4 xl:right-8 bottom-[calc(5rem+var(--safe-b))] xl:bottom-8 transition-opacity"
    onclick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    aria-label="Back to top"
  >↑ Top</button>
{/if}
