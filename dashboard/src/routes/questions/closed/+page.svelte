<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import Badge from "#lib/components/Badge.svelte";
  import Card from "#lib/components/Card.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Page from "#lib/components/Page.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";
  import { toasts } from "#lib/toast.svelte.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let busy = $state<string | null>(null);

  const LABEL: Record<string, string> = {
    answered: "Answered",
    dismissed: "Dismissed",
    resolved: "Settled by the assistant",
    merged: "Merged",
  };

  const OUTCOME: Record<string, { label: string; tone: "success" | "warning" | "error" | "muted" }> = {
    running: { label: "Applying your answer", tone: "warning" },
    done: { label: "Answer applied", tone: "success" },
    failed: { label: "Applying failed", tone: "error" },
  };

  function reopen(id: string): SubmitFunction {
    return ({ action }) => {
      busy = id;
      const rerun = action.search.includes("reprocess");
      return async ({ result, update }) => {
        busy = null;
        if (result.type === "success") {
          toasts.success(rerun ? "Running the answer again." : "Question is back in the queue.");
        } else if (result.type === "failure") {
          toasts.error(String(result.data?.error ?? "That did not go through."));
        }
        await update({ reset: false });
      };
    };
  }
</script>

<Page title="Recently closed questions" size="app" class="flex flex-col gap-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-surface-50">Recently closed questions</h1>
      <p class="mt-1 text-xs text-surface-400">The latest {data.closed.length} questions that were answered, dismissed, settled, or merged.</p>
    </div>
    <a href="/questions" class="tap text-sm text-primary-300 hover:text-primary-200 no-underline">Open questions</a>
  </div>

  {#if data.closed.length === 0}
    <EmptyState title="No closed questions yet." hint="Questions that are answered, dismissed, settled, or merged appear here." />
  {:else}
    <Card as="ul" class="flex flex-col divide-y divide-surface-800 px-4">
      {#each data.closed as q (q.id)}
        <li class="py-4 flex flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <Badge tone={q.status === "answered" ? "success" : "muted"}>{LABEL[q.status] ?? q.status}</Badge>
            <span class="text-surface-400 text-xs">{fmtDateTimeShort(q.answeredAt ?? q.updatedAt)}</span>
          </div>
          <p class="text-surface-100 text-sm">{q.question}</p>
          {#if q.status === "answered" && q.answer}
            <p class="text-surface-300 text-xs">{q.answer}</p>
          {:else if q.status === "merged" && q.mergedQuestion}
            <p class="text-surface-400 text-xs">Now part of: {q.mergedQuestion}</p>
          {/if}
          {#if q.status === "answered" && q.answerStatus}
            {@const outcome = OUTCOME[q.answerStatus]}
            <div class="mt-1 flex flex-col gap-1 rounded border border-surface-800 bg-surface-950 px-3 py-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone={outcome?.tone ?? "muted"}>{outcome?.label ?? q.answerStatus}</Badge>
                {#if q.answerConversationId}
                  <a href="/chat?c={q.answerConversationId}" class="tap text-xs text-primary-300 hover:text-primary-200 no-underline">See every step</a>
                {/if}
              </div>
              {#if q.answerOutcome}
                <p class="text-surface-200 text-xs whitespace-pre-wrap break-words">{q.answerOutcome}</p>
              {/if}
              {#if q.answerStatus !== "done"}
                <form method="POST" action="?/reprocess" use:enhance={reopen(q.id)}>
                  <input type="hidden" name="id" value={q.id} />
                  <button
                    type="submit"
                    disabled={busy !== null}
                    class="btn btn-sm btn-ghost"
                  >
                    {#if busy === q.id}<Spinner label="Running" />{/if}
                    Run again
                  </button>
                </form>
              {/if}
            </div>
          {/if}
          {#if q.statusDetail && q.status !== "answered"}
            <p class="text-surface-400 text-xs">{q.statusDetail}</p>
          {/if}
          {#if q.status !== "answered"}
            <form method="POST" action="?/reopen" use:enhance={reopen(q.id)} class="mt-1">
              <input type="hidden" name="id" value={q.id} />
              <button
                type="submit"
                disabled={busy !== null}
                class="btn btn-sm btn-ghost"
              >
                {#if busy === q.id}<Spinner label="Reopening" />{/if}
                Reopen
              </button>
            </form>
          {/if}
        </li>
      {/each}
    </Card>
  {/if}
</Page>
