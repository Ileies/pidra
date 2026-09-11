<script lang="ts">
  import { enhance } from "$app/forms";
  import Page from "$lib/components/Page.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { toasts } from "$lib/toast.svelte";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let submitting = $state(false);

  // Section 2 blocks on these answers, so the result is worth stating - as a toast, which
  // survives the reload that follows, rather than as a banner above a form that is now gone.
  $effect(() => {
    if (form?.error) toasts.error(form.error);
    else if (form?.success) {
      toasts.success(`${form.answeredCount} answer(s) submitted. Section 2 synthesis will proceed shortly.`);
    }
  });
</script>

<Page title="Questions" size="form" class="flex flex-col gap-6">
  {#if !data.session}
    <EmptyState
      title="No pending questions."
      hint="The question gate opens during Phase 4 when a personal email arrives from a sender the system does not know."
    />
  {:else}
    <div class="flex flex-wrap items-baseline gap-3">
      <h1 class="text-surface-50 font-semibold text-lg">
        {data.session.questions.length} question{data.session.questions.length === 1 ? "" : "s"} pending
      </h1>
      <span class="text-surface-400 text-xs">
        {data.session.minutesLeft}m left · run {data.session.runId}
      </span>
    </div>

    <form
      method="POST"
      action="?/answer"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          submitting = false;
          await update();
        };
      }}
      class="flex flex-col gap-6"
    >
      <input type="hidden" name="run_id" value={data.session.runId} />

      <div class="flex flex-col gap-4">
        {#each data.session.questions as question (question.id)}
          <div class="rounded-lg border border-surface-700 bg-surface-900 p-4 sm:p-5">
            <div class="flex flex-wrap items-baseline gap-2 mb-1">
              <span class="text-xs text-surface-400 uppercase tracking-wider">{question.item_type}</span>
              <span class="text-surface-200 text-sm font-medium break-all">{question.from}</span>
              {#if question.subject}
                <span class="text-surface-400 text-xs truncate max-w-xs">- {question.subject}</span>
              {/if}
            </div>
            <label class="block">
              <span class="block text-surface-100 text-sm mb-3">{question.question}</span>
              <textarea
                name="answer_{question.id}"
                rows="2"
                placeholder="e.g. potential investor, met at a conference"
                class="input-base-flush w-full resize-y"
              ></textarea>
            </label>
          </div>
        {/each}
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          class="tap inline-flex items-center gap-2 px-5 py-2 rounded bg-primary-700 hover:bg-primary-600 border border-primary-600 text-primary-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {#if submitting}<Spinner label="Submitting" />{/if}
          {submitting ? "Submitting…" : "Submit answers"}
        </button>
        <span class="text-surface-400 text-xs">Unanswered questions are marked with ⚠ in Section 2.</span>
      </div>
    </form>
  {/if}
</Page>
