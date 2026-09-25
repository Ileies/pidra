<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import { fmtCost, fmtDateTime, fmtElapsed, fmtNum } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
  import { toastFormResult, toasts } from "#lib/toast.svelte.js";
  import type { ContextBuilderStatus } from "#lib/server/contextBuilder.js";
  import { netJson } from "#lib/offline/net.js";
  import { poll } from "#lib/offline/poll.js";
  import { sync } from "#lib/offline/sync.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The run controls and a correction's revert are online-only (OFFLINE_PLAN.md §1): disabled once
  // the app knows it is offline, with the reason, like the writes on /contacts and /topics.
  const isOffline = $derived(offline.reachable === "offline");

  $effect(() => toastFormResult(form));

  // The harvest is never overwritten here: the assistant records corrections that outrank it.
  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/context-builder",
      digest: [
        "Harvested long-term context.",
        `${data.counts.standing_context} standing rules, ${data.counts.entities} entities, ${data.counts.contacts} contacts,`,
        `${data.corrections.length} active corrections.`,
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

<Page title="Context Builder" size="read" class="flex flex-col gap-6">
  <!-- A newer run exists but is not what is on screen. Shown above the document, not below it:
       the point is that the reader knows before reading which version they are looking at. -->
  {#if data.skipped.length > 0}
    <section class="bg-warning-950 border border-warning-900 rounded-lg p-4 sm:p-5">
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

  <!-- What the builder actually produced. This is the point of the tool, so it comes before
       the run machinery rather than after it. -->
  {#if data.doc}
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
        {@html data.doc.fullContextHtml}
      </article>
    </section>

    <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5 flex flex-col gap-3">
      <h2 class="text-surface-200 text-sm font-semibold">Source summaries</h2>
      {#each data.doc.sections as section (section.title)}
        {#if section.chars > 0}
          <details class="border-b border-surface-800 pb-2 last:border-0">
            <summary class="tap cursor-pointer text-surface-200 text-sm flex items-baseline justify-between gap-3">
              <span>{section.title}</span>
              <span class="text-surface-400 text-xs tabular-nums shrink-0">{fmtNum(section.chars)} chars</span>
            </summary>
            <article class="report-body text-sm max-w-none mt-3">{@html section.html}</article>
          </details>
        {/if}
      {/each}
      <p class="text-surface-400 text-xs break-all">Source file: <code>{data.doc.path}</code></p>
    </section>
  {:else}
    <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
      <h2 class="text-surface-100 text-base font-semibold mb-1">Long-term context</h2>
      <p class="text-surface-300 text-sm">
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

  <!-- The correction layer. The harvest above is never rewritten, so this is where the current
       truth lives; reverting one puts the harvest back in charge of that fact. -->
  <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
    <div class="flex items-baseline justify-between flex-wrap gap-2 mb-1">
      <h2 class="text-surface-200 text-sm font-semibold">Corrections ({data.corrections.length})</h2>
      <a href="/chat" class="text-primary-400 text-xs no-underline hover:text-primary-300">Correct it in the chat →</a>
    </div>
    <p class="text-surface-400 text-xs mb-3">
      Injected into every briefing alongside the document, and authoritative wherever the two
      disagree. Nothing above is overwritten.
    </p>

    {#if data.corrections.length === 0}
      <p class="text-surface-300 text-sm">
        No active corrections. A wrong relationship or fact in the document can be fixed in the
        <a href="/chat" class="text-primary-400 no-underline hover:text-primary-300">context chat</a>.
      </p>
    {:else}
      <ul class="flex flex-col gap-3 text-sm">
        {#each data.corrections as correction (correction.id)}
          <li class="border-b border-surface-800 pb-3 last:border-0">
            <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-surface-400 text-xs break-all">
                  <code>{correction.target_kind}:{correction.target_key}</code> ·
                  {displayLabel(correction.operation)} · {correction.source}
                </div>
                <div class="text-surface-100 mt-1 whitespace-pre-wrap break-words">{correction.statement}</div>
                {#if correction.supersedes_text}
                  <div class="text-surface-400 text-xs mt-1 line-through whitespace-pre-wrap break-words">
                    {correction.supersedes_text}
                  </div>
                {/if}
                {#if correction.rationale}
                  <div class="text-surface-400 text-xs mt-1 whitespace-pre-wrap break-words">{correction.rationale}</div>
                {/if}
                <div class="text-surface-400 text-xs mt-1">{fmtDateTime(correction.created_at)}</div>
              </div>
              <!-- A revert is written on the server, not through the outbox, so the offline copy this
                   page reads only shows it after a pull; forced, because the throttle would skip it. -->
              <form
                method="POST"
                action="?/revertCorrection"
                use:enhance={() => async ({ update, result }) => {
                  await update();
                  if (result.type === "success") await sync({ force: true });
                }}
                class="shrink-0"
              >
                <input type="hidden" name="id" value={correction.id} />
                <button
                  type="submit"
                  disabled={isOffline}
                  title={isOffline ? "Needs the connection" : undefined}
                  class="tap nav-btn nav-btn-muted cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >Revert</button>
              </form>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.standing.length > 0}
    <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5">
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

  <!-- Run status + controls -->
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
      <!-- Live run state is what this section shows, and a copy of it would be a lie (§1). -->
      <p class="text-xs text-surface-400 mb-3">Starting or stopping a run needs the connection. The run status below is the last one seen.</p>
    {/if}

    {#if status?.dbRun}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

  <!-- errors.json is a persistent log across every run ever made, so it is split here by the
       current run's start time: showing the whole file undated made errors from runs abandoned
       days earlier look like the current run's output. -->
  {#if currentErrors.length > 0}
    <section class="bg-surface-900 border border-warning-800 rounded-lg p-4 sm:p-5">
      <h2 class="text-warning-400 text-sm font-semibold mb-3">Errors this run ({currentErrors.length})</h2>
      <ul class="flex flex-col gap-2 text-xs">
        {#each currentErrors as error (error.ts + error.source)}
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
    <section class="bg-surface-900 border border-surface-800 rounded-lg p-4 sm:p-5">
      <details>
        <summary class="tap text-surface-300 text-sm font-semibold cursor-pointer">
          Older errors from previous runs ({olderErrors.length})
        </summary>
        <ul class="flex flex-col gap-2 text-xs mt-3">
          {#each olderErrors as error (error.ts + error.source)}
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
</Page>
