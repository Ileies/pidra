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
    answer: "Answer saved. The assistant is acting on it - see Recently closed questions.",
    dismiss: "Question dismissed.",
    reopen: "Question is back in the queue.",
  };

  const MAX_SOURCES = 3;

  const OPEN_PAGE = 20;
  let visibleOpen = $state(OPEN_PAGE);

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

  function kindBadge(q: PageData["open"][number]): string {
    if (q.kind === "review") return "Weekly review";
    if (q.kind === "chat") return "Asked by the assistant";
    return q.sources[0]?.source_type === "entity" ? "Entity" : "Mail";
  }
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

<Page title="Questions" size="app" class="flex flex-col gap-6">
  <div class="flex justify-end">
    <a href="/questions/closed" class="tap text-xs text-surface-400 hover:text-primary-300">Recently closed questions</a>
  </div>
  {#if data.open.length === 0}
    <EmptyState
      title="No open questions."
      hint="Questions come in when mail arrives from a sender the system cannot place, when an entity keeps recurring without the system ever placing it, and with the weekly review. They wait here until you answer them."
    />
  {:else}
    <div class="flex flex-col gap-1">
      <h1 class="text-surface-50 font-semibold text-lg">
        {data.open.length} open question{data.open.length === 1 ? "" : "s"}
      </h1>
      <p class="text-surface-400 text-xs">
        Answer in any order, one at a time. The briefings never wait for them. The assistant acts on
        each answer right away - it can edit contacts, entities and the context, remove them, write
        notes and to-dos - and says what it did under Recently closed questions.
      </p>
    </div>

    <ul class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 items-start gap-4">
      {#each data.open.slice(0, visibleOpen) as q (q.id)}
        <li class="rounded-lg border bg-surface-900 p-4 sm:p-5 border-surface-700">
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="muted">{kindBadge(q)}</Badge>
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
    {#if visibleOpen < data.open.length}
      <button
        type="button"
        onclick={() => (visibleOpen += OPEN_PAGE)}
        class="tap self-start px-3 py-1.5 rounded text-xs border border-surface-700 text-surface-400 hover:border-surface-500 hover:text-surface-200 transition-colors cursor-pointer"
      >Show more ({data.open.length - visibleOpen} more)</button>
    {/if}
  {/if}

</Page>
