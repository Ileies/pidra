<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";
  let submitting = false;
</script>

<svelte:head>
  <title>PIDRA - Questions</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Question Gate</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 px-8 py-8 max-w-2xl mx-auto w-full">
    {#if form?.success}
      <div class="rounded-lg border border-success-700 bg-success-950 px-5 py-4 text-success-300 text-sm mb-6">
        {form.answeredCount} answer(s) submitted. Section 2 synthesis will proceed shortly.
      </div>
    {/if}

    {#if form?.error}
      <div class="rounded-lg border border-error-700 bg-error-950 px-5 py-4 text-error-300 text-sm mb-6">
        {form.error}
      </div>
    {/if}

    {#if !data.session}
      <div class="text-surface-400 text-sm text-center py-16">
        No pending questions - the gate is not active.
      </div>
    {:else}
      <div class="mb-6 flex items-baseline gap-3">
        <h1 class="text-surface-50 font-semibold text-lg">
          {data.session.questions.length} question{data.session.questions.length === 1 ? "" : "s"} pending
        </h1>
        <span class="text-surface-500 text-xs">
          {data.session.minutesLeft}m left · run {data.session.runId}
        </span>
      </div>

      <form method="POST" action="?/answer" use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          submitting = false;
          await update();
        };
      }}>
        <input type="hidden" name="run_id" value={data.session.runId} />

        <div class="flex flex-col gap-6">
          {#each data.session.questions as q, i}
            <div class="rounded-lg border border-surface-700 bg-surface-900 p-5">
              <div class="flex items-baseline gap-2 mb-1">
                <span class="text-xs text-surface-500 uppercase tracking-wider">{q.item_type}</span>
                <span class="text-surface-300 text-sm font-medium">{q.from}</span>
                {#if q.subject}
                  <span class="text-surface-500 text-xs truncate max-w-xs">- {q.subject}</span>
                {/if}
              </div>
              <p class="text-surface-100 text-sm mb-4">{q.question}</p>
              <textarea
                name="answer_{q.id}"
                rows="2"
                placeholder="e.g. potential investor, met at ETH Zurich event"
                class="w-full bg-surface-950 border border-surface-700 rounded px-3 py-2 text-sm text-surface-100 placeholder-surface-600 resize-y focus:outline-none focus:border-primary-600"
              ></textarea>
            </div>
          {/each}
        </div>

        <div class="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            class="px-4 py-2 rounded bg-primary-700 hover:bg-primary-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting…" : "Submit answers"}
          </button>
          <span class="text-surface-500 text-xs">Unanswered questions will be marked with ⚠ in Section 2.</span>
        </div>
      </form>
    {/if}
  </main>
</div>
