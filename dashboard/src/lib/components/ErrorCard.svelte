<script lang="ts">
  /**
   * A failed run, with every attempt behind it (B2).
   *
   * `withRetry` records a `StepAttemptError` per attempt, and the whole point of writing them to
   * `pipeline_runs.step_errors` is that the dashboard can show what actually happened rather
   * than "failed". Used by the report page and, once it exists, by the runs page.
   *
   * The `degraded` variant covers the other thing `step_errors` carries: a run that completed
   * without one of its sources. Same rows, different meaning - nothing was retried and a report
   * exists - so it gets the warning palette and drops the attempt counter rather than claiming
   * "Attempt 1/3" for something that was never attempted twice.
   */
  import type { Snippet } from "svelte";
  import Badge from "$lib/components/Badge.svelte";
  import { fmtDuration, fmtTime } from "$lib/format";
  import type { StepAttempt } from "$lib/pipeline";

  interface Props {
    /** The step that failed, as recorded by the pipeline. */
    step?: string | null;
    durationMs?: number | null;
    attempts?: StepAttempt[];
    /** `failed`: the run died here. `degraded`: the run finished, these sources did not. */
    variant?: "failed" | "degraded";
    /** Retry button, or anything else the caller wants under the attempts. */
    children?: Snippet;
  }

  let { step, durationMs, attempts = [], variant = "failed", children }: Props = $props();

  const degraded = $derived(variant === "degraded");
</script>

<div
  class="w-full border rounded-lg overflow-hidden text-left {degraded
    ? 'border-warning-800 bg-warning-950'
    : 'border-error-800 bg-error-950'}"
>
  <div class="flex items-center gap-3 px-4 py-3 flex-wrap border-b {degraded ? 'border-warning-800' : 'border-error-800'}">
    {#if degraded}
      <Badge tone="warning" solid>Degraded</Badge>
      <span class="text-sm text-surface-200">
        {attempts.length} source{attempts.length === 1 ? "" : "s"} failed, the briefing was still written
      </span>
    {:else}
      <Badge tone="error" solid>Failed</Badge>
      <span class="text-sm text-surface-200">
        Step: <strong class="text-surface-50 font-mono">{step ?? "unknown"}</strong>
      </span>
    {/if}
    {#if durationMs != null}
      <span class="text-xs text-surface-400 sm:ml-auto">{degraded ? "in" : "after"} {fmtDuration(durationMs)}</span>
    {/if}
  </div>

  {#each attempts as attempt (`${attempt.step}-${attempt.attempt}-${attempt.ts}`)}
    <div class="px-4 py-3 border-b border-surface-700/60 last:border-b-0">
      <div class="flex items-center gap-2.5 mb-1 flex-wrap">
        {#if !degraded}
          <Badge tone="muted">Attempt {attempt.attempt}/3</Badge>
        {/if}
        <span class="text-xs text-surface-400 tabular-nums">{fmtTime(attempt.ts)}</span>
        <span class="text-xs text-surface-400 font-mono ml-auto">{attempt.step}</span>
      </div>
      <!-- On surface-950 rather than the card's own red: an error message sitting on the same
           tone as its container reads as decoration instead of as text. -->
      <pre
        class="font-mono text-xs bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words m-0 {degraded
          ? 'text-warning-400'
          : 'text-error-400'}">{attempt.error}</pre>
      {#if attempt.stack}
        <details class="mt-1">
          <summary class="text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">Stack trace</summary>
          <pre class="font-mono text-xs text-surface-400 bg-surface-950 rounded px-3 py-2 mt-1 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{attempt.stack}</pre>
        </details>
      {/if}
    </div>
  {/each}

  {#if children}
    <div class="px-4 py-3 border-t {degraded ? 'border-warning-800' : 'border-error-800'}">{@render children()}</div>
  {/if}
</div>
