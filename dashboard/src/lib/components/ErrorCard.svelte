<script lang="ts">
  /**
   * A failed run, with every attempt behind it (B2).
   *
   * `withRetry` records a `StepAttemptError` per attempt, and the whole point of writing them to
   * `pipeline_runs.step_errors` is that the dashboard can show what actually happened rather
   * than "failed". Used by the report page and, once it exists, by the runs page.
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
    /** Retry button, or anything else the caller wants under the attempts. */
    children?: Snippet;
  }

  let { step, durationMs, attempts = [], children }: Props = $props();
</script>

<div class="w-full border border-error-800 rounded-lg overflow-hidden text-left bg-error-950">
  <div class="flex items-center gap-3 px-4 py-3 flex-wrap border-b border-error-800">
    <Badge tone="error" solid>Failed</Badge>
    <span class="text-sm text-surface-200">
      Step: <strong class="text-surface-50 font-mono">{step ?? "unknown"}</strong>
    </span>
    {#if durationMs != null}
      <span class="text-xs text-surface-400 sm:ml-auto">after {fmtDuration(durationMs)}</span>
    {/if}
  </div>

  {#each attempts as attempt (`${attempt.step}-${attempt.attempt}-${attempt.ts}`)}
    <div class="px-4 py-3 border-b border-surface-700/60 last:border-b-0">
      <div class="flex items-center gap-2.5 mb-1 flex-wrap">
        <Badge tone="muted">Attempt {attempt.attempt}/3</Badge>
        <span class="text-xs text-surface-400 tabular-nums">{fmtTime(attempt.ts)}</span>
        <span class="text-xs text-surface-400 font-mono ml-auto">{attempt.step}</span>
      </div>
      <!-- On surface-950 rather than the card's own red: an error message sitting on the same
           tone as its container reads as decoration instead of as text. -->
      <pre class="font-mono text-xs text-error-400 bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words m-0">{attempt.error}</pre>
      {#if attempt.stack}
        <details class="mt-1">
          <summary class="text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">Stack trace</summary>
          <pre class="font-mono text-xs text-surface-400 bg-surface-950 rounded px-3 py-2 mt-1 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{attempt.stack}</pre>
        </details>
      {/if}
    </div>
  {/each}

  {#if children}
    <div class="px-4 py-3 border-t border-error-800">{@render children()}</div>
  {/if}
</div>
