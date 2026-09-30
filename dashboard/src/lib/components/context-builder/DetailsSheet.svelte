<script lang="ts">
  /**
   * Everything about a harvest that is meta-information rather than the harvest itself: where to
   * jump, how the run is progressing, the raw figures, and what went wrong. Modeled directly on
   * `SyncSheet.svelte` (scrim + dialog, bottom sheet on mobile, floating panel from `xl`, Esc to
   * close, no transitions) so it behaves like the one overlay pattern the dashboard already has,
   * rather than inventing a second one.
   *
   * Standing rules and Corrections are each already a full page (`/rules`, `/context-builder/corrections`)
   * - this only ever shows their counts and a link out, never the list itself.
   */
  import Badge from "#lib/components/Badge.svelte";
  import StatCard from "#lib/components/StatCard.svelte";
  import { fmtCost, fmtDateTime, fmtNum } from "#lib/format.js";
  import { costUsd, PRICING_CONFIGURED, PRICING_HINT } from "#lib/pricing.js";
  import type { ContextBuilderStatus } from "#lib/server/contextBuilder.js";

  export interface DocHeading {
    id: string;
    title: string;
  }

  export interface SummarySection {
    key: string;
    title: string;
    chars: number;
  }

  export interface ErrorRow {
    ts: string;
    source: string;
    error: string;
  }

  interface Props {
    open: boolean;
    onClose: () => void;
    docHeadings: DocHeading[];
    sections: SummarySection[];
    activeSectionId: string | null;
    onJump: (id: string, tab?: "document" | "summaries") => void;
    status: ContextBuilderStatus | null;
    currentErrors: ErrorRow[];
    olderErrors: ErrorRow[];
    standingCount: number;
    correctionsCount: number;
  }

  let {
    open,
    onClose,
    docHeadings,
    sections,
    activeSectionId,
    onJump,
    status,
    currentErrors,
    olderErrors,
    standingCount,
    correctionsCount,
  }: Props = $props();

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) onClose();
  }

  const PHASES: { key: "email" | "tasks" | "keep" | "github"; label: string }[] = [
    { key: "email", label: "Email" },
    { key: "tasks", label: "Tasks" },
    { key: "keep", label: "Keep" },
    { key: "github", label: "GitHub" },
  ];

  function jump(id: string, tab?: "document" | "summaries") {
    onJump(id, tab);
    onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

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

{#if open}
  <button type="button" aria-label="Close details" class="fixed inset-0 z-40 bg-surface-950/70" onclick={onClose}></button>

  <div
    role="dialog"
    aria-label="Context Builder details"
    aria-modal="true"
    class="fixed inset-x-0 bottom-0 z-50 xl:inset-x-auto xl:right-6
           xl:top-[calc(var(--header-h)+1.5rem)] xl:bottom-6 xl:w-96
           max-h-[85dvh] xl:max-h-none overflow-y-auto
           rounded-t-2xl xl:rounded-2xl border-t xl:border border-surface-700 bg-surface-900
           px-4 pt-3 pb-[calc(1rem+var(--safe-b))] xl:pb-4 flex flex-col gap-5 shadow-2xl"
  >
    <div class="mx-auto xl:hidden mb-1 h-1 w-10 rounded-full bg-surface-600" aria-hidden="true"></div>

    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-surface-100">Details</h2>
      <button
        type="button"
        onclick={onClose}
        aria-label="Close"
        class="tap text-surface-400 hover:text-surface-200 cursor-pointer bg-transparent border-none px-1"
      >✕</button>
    </div>

    {#if docHeadings.length > 0 || sections.length > 0}
      <!-- xl+ already has a persistent Quick Links rail alongside the document; this stays for
           mobile, where there is no room for it. -->
      <div class="flex flex-col gap-3 text-sm xl:hidden">
        <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Quick links</span>
        {#if docHeadings.length > 0}
          <div class="flex flex-col gap-0.5">
            <span class="text-surface-500 text-xs">Document</span>
            {#each docHeadings as heading (heading.id)}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer {activeSectionId === heading.id ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jump(heading.id, "document")}
              >{heading.title}</button>
            {/each}
          </div>
        {/if}
        {#if sections.length > 0}
          <div class="flex flex-col gap-0.5">
            <span class="text-surface-500 text-xs">Source summaries</span>
            {#each sections as section (section.key)}
              <button
                type="button"
                class="tap text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer flex items-baseline justify-between gap-2 {activeSectionId === `summary-${section.key}` ? 'bg-primary-950 text-primary-300' : 'text-surface-300 hover:bg-surface-800'}"
                onclick={() => jump(`summary-${section.key}`, "summaries")}
              >
                <span>{section.title}</span>
                <span class="text-surface-500 tabular-nums shrink-0">{fmtNum(section.chars)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if status?.checkpoint}
      {@const checkpoint = status.checkpoint}
      <div class="flex flex-col gap-3">
        <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Steps</span>
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
      </div>

      <div class="flex flex-col gap-3">
        <span class="text-surface-500 text-xs uppercase tracking-wide font-semibold">Numbers</span>
        <div class="grid grid-cols-2 gap-3">
          <StatCard
            label="Memory (RSS)"
            value={status.trackedByDashboard && status.rssMb != null ? `${fmtNum(status.rssMb)} MB` : "not tracked"}
          />
          <StatCard
            label="OpenAI cost"
            value={fmtCost(costUsd(checkpoint.openaiTokensIn, checkpoint.openaiTokensOut))}
            hint={PRICING_CONFIGURED ? undefined : PRICING_HINT}
          />
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
      </div>
    {/if}

    {#if currentErrors.length > 0}
      <div class="flex flex-col gap-2">
        <span class="text-warning-400 text-xs uppercase tracking-wide font-semibold">Errors this run ({currentErrors.length})</span>
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
      </div>
    {/if}

    {#if olderErrors.length > 0}
      <details class="text-surface-300">
        <summary class="tap text-sm font-semibold cursor-pointer">
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
    {/if}

    <!-- Standing rules and Corrections each already have their own page - this is a pointer, not
         a second copy of either list. -->
    <div class="flex flex-col gap-1 border-t border-surface-800 pt-3 text-sm">
      <a
        href="/rules"
        class="tap text-left px-2 py-1 rounded text-primary-400 hover:bg-surface-800 flex items-center justify-between no-underline"
      >
        <span>Standing rules ({standingCount})</span>
        <span aria-hidden="true">→</span>
      </a>
      <a
        href="/context-builder/corrections"
        class="tap text-left px-2 py-1 rounded text-primary-400 hover:bg-surface-800 flex items-center justify-between no-underline"
      >
        <span>Corrections ({correctionsCount})</span>
        <span aria-hidden="true">→</span>
      </a>
    </div>
  </div>
{/if}
