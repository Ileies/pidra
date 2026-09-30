<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import Badge from "#lib/components/Badge.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import ErrorCard from "#lib/components/ErrorCard.svelte";
  import Page from "#lib/components/Page.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { fmtDate, fmtDateTimeShort } from "#lib/format.js";
  import { toasts } from "#lib/toast.svelte.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let busy = $state<string | null>(null);

  const total = $derived(data.questions.length + data.reports.length + data.runs.length);

  function acknowledge(id: string, message: string): SubmitFunction {
    return ({ action }) => {
      busy = id;
      return async ({ result, update }) => {
        busy = null;
        if (result.type === "success") toasts.success(message);
        else if (result.type === "failure") toasts.error(String(result.data?.error ?? "That did not go through."));
        await update({ reset: false });
      };
    };
  }
</script>

<Page title="Notifications" size="app" class="flex flex-col gap-6">
  <div>
    <h1 class="text-xl font-bold text-surface-50">Notifications</h1>
    <p class="mt-1 text-xs text-surface-400">{total === 0 ? "You are up to date." : `${total} item${total === 1 ? "" : "s"} waiting for you.`}</p>
  </div>

  {#if total === 0}
    <EmptyState title="Nothing new." hint="New reports, open questions, and pipeline issues appear here." />
  {:else}
    {#if data.questions.length > 0}
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-surface-100">Questions <Badge tone="warning">{data.questions.length}</Badge></h2>
          <a href="/questions" class="text-xs text-primary-300 hover:text-primary-200 no-underline">Open queue</a>
        </div>
        <ul class="flex flex-col divide-y divide-surface-800 rounded-lg border border-surface-700 bg-surface-900 px-4">
          {#each data.questions as question (question.id)}
            <li class="py-3">
              <p class="text-sm text-surface-100">{question.question}</p>
              <p class="mt-1 text-xs text-surface-400">{question.kind === "review" ? "Weekly review" : "Mail"} · asked {fmtDate(question.firstAsked)}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.reports.length > 0}
      <section class="flex flex-col gap-3">
        <h2 class="text-base font-semibold text-surface-100">Unread reports <Badge tone="warning">{data.reports.length}</Badge></h2>
        <ul class="flex flex-col divide-y divide-surface-800 rounded-lg border border-surface-700 bg-surface-900 px-4">
          {#each data.reports as report (report.date)}
            <li class="flex flex-wrap items-center gap-3 py-3">
              <a href="/{report.date}" class="flex-1 text-sm text-primary-300 hover:text-primary-200 no-underline">Briefing for {fmtDate(report.date)}</a>
              <span class="text-xs text-surface-400">{fmtDateTimeShort(report.createdAt)}</span>
              <form method="POST" action="?/readReport" use:enhance={acknowledge(`report:${report.date}`, "Report marked as read.")}>
                <input type="hidden" name="date" value={report.date} />
                <button type="submit" disabled={busy !== null} class="tap inline-flex items-center gap-2 rounded border border-surface-600 px-3 py-1 text-xs text-surface-300 hover:border-surface-400 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                  {#if busy === `report:${report.date}`}<Spinner label="Marking as read" />{/if}
                  Mark read
                </button>
              </form>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if data.runs.length > 0}
      <section class="flex flex-col gap-3">
        <h2 class="text-base font-semibold text-surface-100">Unreviewed errors and warnings <Badge tone="error">{data.runs.length}</Badge></h2>
        <ul class="flex flex-col gap-3">
          {#each data.runs as run (run.id)}
            {@const failed = run.status === "failed"}
            <li class="rounded-lg border border-surface-700 bg-surface-900 p-4">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <a href="/runs" class="text-sm text-primary-300 hover:text-primary-200 no-underline">{failed ? "Failed" : "Degraded"} run on {fmtDate(run.date)}</a>
                {#if run.startedAt}<span class="text-xs text-surface-400">{fmtDateTimeShort(run.startedAt)}</span>{/if}
              </div>
              <ErrorCard step={run.failedStep} attempts={run.attempts} variant={failed ? "failed" : "degraded"} />
              <form method="POST" action="?/reviewRun" use:enhance={acknowledge(`run:${run.id}`, "Run issue marked as reviewed.")} class="mt-3">
                <input type="hidden" name="id" value={run.id} />
                <button type="submit" disabled={busy !== null} class="tap inline-flex items-center gap-2 rounded border border-surface-600 px-3 py-1 text-xs text-surface-300 hover:border-surface-400 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                  {#if busy === `run:${run.id}`}<Spinner label="Marking as reviewed" />{/if}
                  Mark reviewed
                </button>
              </form>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</Page>
