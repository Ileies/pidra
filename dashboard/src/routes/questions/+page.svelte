<script lang="ts">
  import { enhance, type SubmitFunction } from "$app/forms";
  import Page from "#lib/components/Page.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import { fmtDay, fmtDateTimeShort } from "#lib/format.js";
  import { toasts } from "#lib/toast.svelte.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /** Typed answers by question id, so an answer sent for one card never clears another's draft. */
  let drafts = $state<Record<string, string>>({});
  /** `${id}:${op}` of the request in flight, for that button's spinner. */
  let busy = $state<string | null>(null);

  const DONE: Record<string, string> = {
    answer: "Answer saved.",
    dismiss: "Question dismissed.",
    reopen: "Question is back in the queue.",
  };

  const CLOSED_LABEL: Record<string, string> = {
    answered: "Answered",
    dismissed: "Dismissed",
    resolved: "Settled by the assistant",
    merged: "Merged",
  };

  const MAX_SOURCES = 3;

  function submit(id: string): SubmitFunction {
    return ({ action }) => {
      const op = action.search.replace(/^\?\//, "");
      busy = `${id}:${op}`;
      return async ({ result, update }) => {
        busy = null;
        if (result.type === "success") {
          toasts.success(DONE[op] ?? "Saved.");
          if (op === "answer") delete drafts[id];
          await update({ reset: false });
        } else if (result.type === "failure") {
          toasts.error(String(result.data?.error ?? "That did not go through."));
        } else {
          await update({ reset: false });
        }
      };
    };
  }

  function sendOnShortcut(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  const waiting = $derived(data.open.filter((q) => q.blockingMinutesLeft !== null));
</script>

{#snippet sources(list: PageData["open"][number]["sources"])}
  {#if list.length > 0}
    <ul class="flex flex-col gap-0.5 mb-2">
      {#each list.slice(0, MAX_SOURCES) as source, i (i)}
        <li class="text-xs text-surface-400 min-w-0 truncate">
          <span class="text-surface-200 break-all">{source.from}</span>
          {#if source.subject}<span> · {source.subject}</span>{/if}
          <span> · {fmtDay(source.run_date)}</span>
        </li>
      {/each}
      {#if list.length > MAX_SOURCES}
        <li class="text-xs text-surface-400">and {list.length - MAX_SOURCES} more mail{list.length - MAX_SOURCES === 1 ? "" : "s"}</li>
      {/if}
    </ul>
  {/if}
{/snippet}

<Page title="Questions" size="form" class="flex flex-col gap-6">
  {#if data.open.length === 0}
    <EmptyState
      title="No open questions."
      hint="Questions come in when mail arrives from a sender the system cannot place, and with the weekly review. They wait here until you answer them."
    />
  {:else}
    <div class="flex flex-col gap-1">
      <h1 class="text-surface-50 font-semibold text-lg">
        {data.open.length} open question{data.open.length === 1 ? "" : "s"}
      </h1>
      <p class="text-surface-400 text-xs">
        Answer in any order, one at a time. Each answer counts as soon as you send it.
        {#if waiting.length > 0}
          Today's briefing is waiting for {waiting.length === 1 ? "one of them" : `${waiting.length} of them`}.
        {/if}
      </p>
    </div>

    <ul class="flex flex-col gap-4">
      {#each data.open as q (q.id)}
        <li class="rounded-lg border bg-surface-900 p-4 sm:p-5 {q.blockingMinutesLeft !== null ? 'border-warning-800' : 'border-surface-700'}">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="muted">{q.kind === "review" ? "Weekly review" : "Mail"}</Badge>
            {#if q.blockingMinutesLeft !== null}
              <Badge tone="warning">Briefing waiting · {q.blockingMinutesLeft}m left</Badge>
            {/if}
            <span class="text-surface-400 text-xs">
              {#if q.timesAsked > 1}
                Came up on {q.timesAsked} days since {fmtDay(q.firstAsked)}
              {:else}
                Asked {fmtDay(q.firstAsked)}
              {/if}
            </span>
          </div>

          {@render sources(q.sources)}

          <form method="POST" action="?/answer" use:enhance={submit(q.id)} class="flex flex-col gap-3">
            <input type="hidden" name="id" value={q.id} />
            <label class="block">
              <span class="block text-surface-100 text-sm mb-2">{q.question}</span>
              <textarea
                name="answer"
                rows="2"
                bind:value={drafts[q.id]}
                onkeydown={sendOnShortcut}
                placeholder={q.kind === "review" ? "A sentence or two is plenty" : "e.g. my landlord, handles the flat's repairs"}
                class="input-base-flush w-full resize-y"
              ></textarea>
            </label>

            {#if q.history.length > 0}
              <details class="text-xs">
                <summary class="tap text-surface-400 cursor-pointer select-none hover:text-surface-200">
                  Rephrased {q.history.length === 1 ? "once" : `${q.history.length} times`}
                </summary>
                <ol class="mt-2 flex flex-col gap-2 border-l border-surface-700 pl-3">
                  {#each [...q.history].reverse() as rev, i (i)}
                    <li>
                      <p class="text-surface-300">{rev.question}</p>
                      <p class="text-surface-400">
                        Changed {fmtDateTimeShort(rev.at)}{#if rev.reason}: {rev.reason}{/if}
                      </p>
                    </li>
                  {/each}
                </ol>
              </details>
            {/if}

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={busy !== null}
                class="tap inline-flex items-center gap-2 px-4 py-1.5 rounded bg-primary-700 hover:bg-primary-600 border border-primary-600 text-primary-50 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {#if busy === `${q.id}:answer`}<Spinner label="Sending" />{/if}
                Send
              </button>
              <button
                type="submit"
                formaction="?/dismiss"
                disabled={busy !== null}
                class="tap inline-flex items-center gap-2 px-4 py-1.5 rounded border border-surface-500 text-surface-300 text-sm hover:text-surface-100 hover:border-surface-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {#if busy === `${q.id}:dismiss`}<Spinner label="Dismissing" />{/if}
                Dismiss
              </button>
            </div>
          </form>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data.closed.length > 0}
    <details class="bg-surface-900 border border-surface-700 rounded-lg px-4 py-3">
      <summary class="tap text-xs text-surface-400 cursor-pointer select-none hover:text-surface-200">
        Recently closed ({data.closed.length})
      </summary>
      <ul class="mt-3 flex flex-col divide-y divide-surface-800">
        {#each data.closed as q (q.id)}
          <li class="py-3 flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <Badge tone={q.status === "answered" ? "success" : "muted"}>{CLOSED_LABEL[q.status] ?? q.status}</Badge>
              <span class="text-surface-400 text-xs">{fmtDateTimeShort(q.answeredAt ?? q.updatedAt)}</span>
            </div>
            <p class="text-surface-200 text-sm">{q.question}</p>
            {#if q.status === "answered" && q.answer}
              <p class="text-surface-300 text-xs">{q.answer}</p>
            {:else if q.status === "merged" && q.mergedIntoText}
              <p class="text-surface-400 text-xs">Now part of: {q.mergedIntoText}</p>
            {/if}
            {#if q.statusDetail && q.status !== "answered"}
              <p class="text-surface-400 text-xs">{q.statusDetail}</p>
            {/if}
            {#if q.status !== "answered"}
              <form method="POST" action="?/reopen" use:enhance={submit(q.id)}>
                <input type="hidden" name="id" value={q.id} />
                <button
                  type="submit"
                  disabled={busy !== null}
                  class="tap inline-flex items-center gap-2 mt-1 px-3 py-1 rounded border border-surface-600 text-surface-300 text-xs hover:text-surface-100 hover:border-surface-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {#if busy === `${q.id}:reopen`}<Spinner label="Reopening" />{/if}
                  Reopen
                </button>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</Page>
