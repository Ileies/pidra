<script lang="ts">
  /** A day with no report: the run in flight, the run that failed, or nothing at all, plus the way to start one. */
  import { enhance } from "$app/forms";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { fmtDate } from "#lib/format.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import type { StepAttempt } from "#lib/pipeline.js";

  interface Props {
    date: string;
    pipelineRun: {
      status: string;
      failedStep?: string | null;
      durationMs?: number | null;
      stepErrors?: StepAttempt[];
    } | null;
    polling: boolean;
    liveStatus: string | null;
    triggering: boolean;
  }

  let { date, pipelineRun, polling, liveStatus, triggering = $bindable() }: Props = $props();
</script>

<div class="flex flex-col items-center gap-5 pt-10 text-center text-surface-300">
  {#if polling || pipelineRun?.status === "running"}
    <p class="text-primary-400 text-sm inline-flex items-center gap-2">
      <Spinner label="Pipeline running" />
      The pipeline is running{liveStatus && liveStatus !== "running" ? ` (${liveStatus})` : ""}. This page
      updates itself.
    </p>
  {:else if pipelineRun?.status === "failed"}
    <ErrorCard step={pipelineRun.failedStep} durationMs={pipelineRun.durationMs} attempts={pipelineRun.stepErrors} />
  {:else}
    <p>No report for {fmtDate(date)}.</p>
  {/if}

  <!-- A run that failed or produced nothing is exactly when the reader wants to know what did
       arrive, so the link is here too and not only on the stats bar. -->
  <a href="/{date}/triage" class="text-xs text-primary-400 no-underline hover:text-primary-300">
    See what was ingested on this day →
  </a>

  {#if !triggering && !polling && pipelineRun?.status !== "running"}
    <form
      method="POST"
      action="?/runPipeline"
      use:enhance={() => {
        triggering = true;
        return async ({ update }) => {
          await update();
          triggering = false;
        };
      }}
    >
      <button type="submit" disabled={offline.isOffline} class="btn btn-lg btn-primary">
        {pipelineRun?.status === "failed" ? "Retry" : "Run pipeline now"}
      </button>
    </form>
    {#if offline.isOffline}
      <p class="text-xs text-surface-400">Running the pipeline needs the connection.</p>
    {/if}
  {/if}
</div>
