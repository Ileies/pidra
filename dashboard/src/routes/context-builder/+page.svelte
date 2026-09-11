<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import type { ContextBuilderStatus } from "$lib/server/contextBuilder";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The harvest is never overwritten here: the assistant records corrections that outrank it.
  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/context-builder",
      digest: [
        "Harvested long-term context.",
        `${data.counts.standing_context} Standing Rules, ${data.counts.entities} Entities, ${data.counts.contacts} Contacts,`,
        `${data.corrections.length} aktive Korrekturen.`,
        data.doc ? "Das Kontext-Dokument ist vorhanden." : "Es gibt noch kein Kontext-Dokument.",
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
  let actionError = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function refresh() {
    try {
      const res = await fetch("/api/context-builder/status");
      status = await res.json();
    } catch {
      // transient - next poll will retry
    }
  }

  async function start(mode: "full" | "update" | null) {
    starting = true;
    actionError = null;
    try {
      const res = await fetch("/api/context-builder/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json();
      if (!body.ok) actionError = body.error ?? "Failed to start.";
      await refresh();
    } finally {
      starting = false;
    }
  }

  async function stop() {
    stopping = true;
    actionError = null;
    try {
      const res = await fetch("/api/context-builder/stop", { method: "POST" });
      const body = await res.json();
      if (!body.ok) actionError = body.error ?? "Failed to stop.";
      await refresh();
    } finally {
      stopping = false;
    }
  }

  onMount(() => {
    refresh();
    pollTimer = setInterval(refresh, 2000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  function fmtNum(n: number | null | undefined): string {
    if (n == null) return "-";
    return n.toLocaleString("de-DE");
  }

  // Always with the date: errors.json spans every run ever made, and a time-only label made
  // failures from days-old abandoned runs read as the current run's.
  function fmtTs(ts: string): string {
    return new Date(ts).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // The current run's window starts at the checkpoint's start, falling back to the DB run row.
  const runStartedAt = $derived(status?.checkpoint?.startedAt ?? status?.dbRun?.started_at ?? null);
  const currentErrors = $derived(
    runStartedAt
      ? (status?.errors ?? []).filter((e) => new Date(e.ts) >= new Date(runStartedAt))
      : (status?.errors ?? []),
  );
  const olderErrors = $derived(
    runStartedAt
      ? (status?.errors ?? []).filter((e) => new Date(e.ts) < new Date(runStartedAt))
      : [],
  );

  function fmtCost(tokensIn: number, tokensOut: number): string {
    const cost = (tokensIn / 1_000_000) * 3.0 + (tokensOut / 1_000_000) * 15.0;
    return `$${cost.toFixed(3)}`;
  }

  function fmtElapsed(startedAt: string | undefined): string {
    if (!startedAt) return "-";
    const secs = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }

  function statusBadgeClass(s: string | undefined): string {
    if (s === "running") return "bg-primary-950 text-primary-400 border-primary-700";
    if (s === "completed") return "bg-success-950 text-success-400 border-success-700";
    if (s === "failed") return "bg-error-950 text-error-400 border-error-700";
    return "bg-surface-800 text-surface-400 border-surface-700";
  }

  const PHASES: { key: "email" | "tasks" | "keep" | "github"; label: string }[] = [
    { key: "email", label: "Email" },
    { key: "tasks", label: "Tasks" },
    { key: "keep", label: "Keep" },
    { key: "github", label: "GitHub" },
  ];

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";
</script>

<svelte:head>
  <title>PIDRA - Context Builder</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-2 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-center gap-4">
      <a href="/" class="flex items-center gap-1.5 no-underline hover:opacity-90 transition-opacity">
        <img src="/icons/icon.svg" alt="" class="h-8 w-8 drop-shadow-[0_0_3px_rgba(120,157,104,0.55)]" />
        <span class="font-bold tracking-widest text-lg text-surface-50">PIDRA</span>
      </a>
      <span class="text-surface-500 text-sm">Context Builder</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/chat" class="{navBtn} border-primary-700 text-primary-400 hover:bg-surface-800">Kontext korrigieren</a>
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="max-w-4xl mx-auto px-6 py-6 pb-16 w-full flex flex-col gap-6">
    <!-- What the builder actually produced. This is the point of the tool, so it comes before
         the run machinery rather than after it. -->
    {#if data.doc}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
        <div class="flex items-baseline justify-between flex-wrap gap-2 mb-1">
          <h2 class="text-surface-100 text-base font-semibold">Long-term context</h2>
          <span class="text-surface-500 text-xs tabular-nums">
            {fmtNum(data.doc.chars)} chars
            {#if data.doc.generatedAt}· built {fmtTs(data.doc.generatedAt)}{/if}
          </span>
        </div>
        <p class="text-surface-500 text-xs mb-4">
          Synthesised from {fmtNum(data.counts.indexed_email)} emails and
          {fmtNum(data.counts.indexed_keep)} Keep notes. Seeded
          {fmtNum(data.counts.contacts)} contacts, {fmtNum(data.counts.entities)} entities and
          {fmtNum(data.counts.standing_context)} standing rules.
        </p>
        <article class="report-body text-sm max-w-none">
          {@html data.doc.fullContextHtml}
        </article>
      </section>

      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5 flex flex-col gap-3">
        <h2 class="text-surface-200 text-sm font-semibold">Source summaries</h2>
        {#each data.doc.sections as s}
          {#if s.chars > 0}
            <details class="border-b border-surface-800 pb-2 last:border-0">
              <summary class="cursor-pointer text-surface-300 text-sm flex items-baseline justify-between gap-3">
                <span>{s.title}</span>
                <span class="text-surface-600 text-xs tabular-nums shrink-0">{fmtNum(s.chars)} chars</span>
              </summary>
              <article class="report-body text-sm max-w-none mt-3">{@html s.html}</article>
            </details>
          {/if}
        {/each}
        <p class="text-surface-600 text-xs">Source file: <code>{data.doc.path}</code></p>
      </section>
    {:else}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
        <h2 class="text-surface-100 text-base font-semibold mb-1">Long-term context</h2>
        <p class="text-surface-400 text-sm">
          {#if data.docError}
            The last completed run recorded an output file, but it could not be read:
            <code class="text-warning-400">{data.docError}</code>
          {:else if data.run}
            The last completed run recorded no output file. Re-run to generate the document.
          {:else}
            No completed run yet. Start one below to build the context document.
          {/if}
        </p>
      </section>
    {/if}

    <!-- The correction layer. The harvest above is never rewritten, so this is where the
         current truth lives; reverting one puts the harvest back in charge of that fact. -->
    <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
      <div class="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h2 class="text-surface-200 text-sm font-semibold">Korrekturen ({data.corrections.length})</h2>
        <a href="/chat" class="text-primary-400 text-xs no-underline hover:text-primary-300">Im Chat korrigieren →</a>
      </div>
      <p class="text-surface-500 text-xs mb-3">
        Werden zusätzlich zum Dokument in jedes Briefing injiziert und schlagen es dort, wo sie sich
        widersprechen. Nichts oben wird dabei überschrieben.
      </p>

      {#if form?.error}
        <p class="text-error-400 text-xs mb-3">{form.error}</p>
      {:else if form?.message}
        <p class="text-success-400 text-xs mb-3">{form.message}</p>
      {/if}

      {#if data.corrections.length === 0}
        <p class="text-surface-500 text-sm">
          Keine aktiven Korrekturen. Falsche Beziehungen oder Fakten im Dokument lassen sich im
          <a href="/chat" class="text-primary-400 no-underline hover:text-primary-300">Context Chat</a> beheben.
        </p>
      {:else}
        <ul class="flex flex-col gap-3 text-sm">
          {#each data.corrections as correction}
            <li class="border-b border-surface-800 pb-3 last:border-0">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="min-w-0 flex-1">
                  <div class="text-surface-500 text-xs">
                    <code>{correction.target_kind}:{correction.target_key}</code> · {correction.operation} · {correction.source}
                  </div>
                  <div class="text-surface-100 mt-1 whitespace-pre-wrap break-words">{correction.statement}</div>
                  {#if correction.supersedes_text}
                    <div class="text-surface-600 text-xs mt-1 line-through whitespace-pre-wrap break-words">
                      {correction.supersedes_text}
                    </div>
                  {/if}
                  {#if correction.rationale}
                    <div class="text-surface-500 text-xs mt-1 whitespace-pre-wrap break-words">{correction.rationale}</div>
                  {/if}
                  <div class="text-surface-600 text-xs mt-1">{fmtTs(correction.created_at)}</div>
                </div>
                <form method="POST" action="?/revertCorrection" use:enhance class="shrink-0">
                  <input type="hidden" name="id" value={correction.id} />
                  <button
                    type="submit"
                    class="{navBtn} border-surface-700 text-surface-400 hover:bg-surface-800 cursor-pointer"
                  >
                    Zurücknehmen
                  </button>
                </form>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if data.standing.length > 0}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
        <h2 class="text-surface-200 text-sm font-semibold mb-1">
          Standing rules ({data.standing.length})
        </h2>
        <p class="text-surface-500 text-xs mb-3">
          Persistent rules extracted from your Keep notes, stored in <code>standing_context</code>.
        </p>
        <ul class="flex flex-col gap-2 text-sm">
          {#each data.standing as rule}
            <li class="border-b border-surface-800 pb-2 last:border-0">
              <div class="text-surface-200 whitespace-pre-wrap break-words">{rule.value}</div>
              <div class="text-surface-600 text-xs mt-1">
                <code>{rule.key}</code> · {rule.source}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Run status + controls -->
    <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="flex items-center gap-3">
          <span class="badge border {statusBadgeClass(status?.dbRun?.status)} text-xs px-2.5 py-1 rounded">
            {status?.dbRun?.status ?? (status ? "idle" : "loading…")}
          </span>
          {#if status?.dbRun}
            <span class="text-surface-500 text-sm">{status.dbRun.mode} mode</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <button
            class="{navBtn} border-primary-700 text-primary-400 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={starting || status?.running}
            onclick={() => start(null)}
          >
            {starting ? "Starting…" : "Start"}
          </button>
          <button
            class="{navBtn} border-surface-700 text-surface-400 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={starting || status?.running}
            onclick={() => start("full")}
          >
            Force Full
          </button>
          <button
            class="{navBtn} border-error-700 text-error-400 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={stopping || !status?.trackedByDashboard}
            onclick={stop}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      </div>

      {#if actionError}
        <p class="text-error-400 text-xs mb-3">{actionError}</p>
      {/if}

      {#if status?.dbRun}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div class="text-surface-500 text-xs">Elapsed</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtElapsed(status.dbRun.started_at)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Items indexed</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.dbRun.items_indexed)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Memory (RSS)</div>
            <div class="text-surface-100 font-semibold tabular-nums">
              {status.trackedByDashboard && status.rssMb != null ? `${fmtNum(status.rssMb)} MB` : "not tracked"}
            </div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">OpenAI cost</div>
            <div class="text-surface-100 font-semibold tabular-nums">
              {status.checkpoint ? fmtCost(status.checkpoint.openaiTokensIn, status.checkpoint.openaiTokensOut) : "-"}
            </div>
          </div>
        </div>
      {:else if status}
        <p class="text-surface-500 text-sm">No runs yet.</p>
      {/if}
    </section>

    <!-- Phase progress -->
    {#if status?.checkpoint}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5 flex flex-col gap-4">
        <h2 class="text-surface-200 text-sm font-semibold">Steps</h2>

        {#each PHASES as phase}
          {@const p = status.checkpoint.phases[phase.key]}
          {@const pct = p.total > 0 ? Math.min(100, Math.round((p.processed / p.total) * 100)) : (p.done ? 100 : 0)}
          <div>
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="text-surface-300">{phase.label}</span>
              <span class="text-surface-500 tabular-nums">
                {#if p.done}
                  done{p.skipped > 0 ? ` · ${fmtNum(p.skipped)} skipped` : ""}
                {:else if p.total > 0}
                  {fmtNum(p.processed)} / {fmtNum(p.total)}{p.skipped > 0 ? ` · ${fmtNum(p.skipped)} skipped` : ""}
                {:else}
                  waiting…
                {/if}
              </span>
            </div>
            <div class="h-2 rounded-full bg-surface-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500 {p.done ? 'bg-success-500' : 'bg-primary-500'}"
                style="width: {pct}%"
              ></div>
            </div>
          </div>
        {/each}

        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="text-surface-300">Synthesis</span>
            <span class="text-surface-500">{status.checkpoint.phases.synthesis.done ? "done" : "waiting…"}</span>
          </div>
          <div class="h-2 rounded-full bg-surface-800 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500 {status.checkpoint.phases.synthesis.done ? 'bg-success-500' : 'bg-surface-700'}"
              style="width: {status.checkpoint.phases.synthesis.done ? 100 : 0}%"
            ></div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="text-surface-300">DB Seed</span>
            <span class="text-surface-500">{status.checkpoint.phases.dbSeed.done ? "done" : "waiting…"}</span>
          </div>
          <div class="h-2 rounded-full bg-surface-800 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500 {status.checkpoint.phases.dbSeed.done ? 'bg-success-500' : 'bg-surface-700'}"
              style="width: {status.checkpoint.phases.dbSeed.done ? 100 : 0}%"
            ></div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Numbers -->
    {#if status?.checkpoint}
      <section class="bg-surface-900 border border-surface-700 rounded-lg p-5">
        <h2 class="text-surface-200 text-sm font-semibold mb-3">Numbers</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div class="text-surface-500 text-xs">Tokens in</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.checkpoint.openaiTokensIn)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Tokens out</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.checkpoint.openaiTokensOut)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Emails extracted</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.checkpoint.phases.email.processed)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Notes extracted</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.checkpoint.phases.keep.processed)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">GitHub repos</div>
            <div class="text-surface-100 font-semibold tabular-nums">{fmtNum(status.checkpoint.phases.github.processed || status.checkpoint.phases.github.total)}</div>
          </div>
          <div>
            <div class="text-surface-500 text-xs">Errors this run</div>
            <div class="font-semibold tabular-nums {currentErrors.length > 0 ? 'text-warning-400' : 'text-surface-100'}">{fmtNum(currentErrors.length)}</div>
          </div>
        </div>
      </section>
    {/if}

    <!-- Errors. errors.json is a persistent log across every run ever made, so it is split
         here by the current run's start time: showing the whole file undated made errors from
         abandoned runs days earlier look like the current run's output. -->
    {#if currentErrors.length > 0}
      <section class="bg-surface-900 border border-warning-800 rounded-lg p-5">
        <h2 class="text-warning-400 text-sm font-semibold mb-3">Errors this run ({currentErrors.length})</h2>
        <ul class="flex flex-col gap-2 text-xs">
          {#each currentErrors as err}
            <li class="border-b border-surface-800 pb-2">
              <div class="flex items-center gap-2">
                <span class="badge bg-surface-800 text-surface-400 px-1.5 py-0.5 rounded">{err.source}</span>
                <span class="text-surface-600">{fmtTs(err.ts)}</span>
              </div>
              <div class="text-surface-400 mt-1 whitespace-pre-wrap break-words">{err.error}</div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if olderErrors.length > 0}
      <section class="bg-surface-900 border border-surface-800 rounded-lg p-5">
        <details>
          <summary class="text-surface-400 text-sm font-semibold cursor-pointer">
            Older errors from previous runs ({olderErrors.length})
          </summary>
          <ul class="flex flex-col gap-2 text-xs mt-3">
            {#each olderErrors as err}
              <li class="border-b border-surface-800 pb-2">
                <div class="flex items-center gap-2">
                  <span class="badge bg-surface-800 text-surface-500 px-1.5 py-0.5 rounded">{err.source}</span>
                  <span class="text-surface-600">{fmtTs(err.ts)}</span>
                </div>
                <div class="text-surface-500 mt-1 whitespace-pre-wrap break-words">{err.error}</div>
              </li>
            {/each}
          </ul>
        </details>
      </section>
    {/if}
  </main>
</div>
