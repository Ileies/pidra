<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import Badge from "#lib/components/Badge.svelte";
  import Diff from "#lib/components/Diff.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { fmtDateTime } from "#lib/format.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => toastFormResult(form));

  /** Diff by default, full text behind a toggle: the diff is what the decision needs (D6). */
  let showFullText = $state<Record<string, boolean>>({});

  // The assistant may propose a version here, never activate one: prompt changes require human
  // approval, and activation lives on this page.
  $effect(() => {
    setPageContext({
      surface: "prompts",
      route: "/prompts",
      digest: `Prompt management: ${data.sections.length} sections. ${data.sections
        .map((section) => `${section.section}: ${section.versions.length} version(s)`)
        .join(", ")}.`,
      focus: data.sections.map((section) => ({ kind: "section", id: section.section })),
    });
  });
</script>

<Page title="Prompts" size="read" class="flex flex-col gap-6">
  <p class="text-xs text-surface-400 max-w-prose">
    Every section runs on the active version from the database. Where there is none, the prompt
    from the code baseline runs instead. Activating a version takes effect on the next pipeline
    run, without a deploy.
  </p>

  {#if data.sections.length === 0}
    <EmptyState title="The skills bridge is not reachable." hint="Prompt versions are served by the bridge on localhost:4000." />
  {:else}
    <div class="flex flex-col gap-8">
      {#each data.sections as group (group.section)}
        <section>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <h2 class="font-mono text-sm font-semibold text-surface-200 uppercase tracking-wider">{group.section}</h2>
            {#if !group.effective}
              <Badge tone="warning">Not read</Badge>
            {:else if group.effective.source === "db"}
              <Badge tone="success">Running v{group.effective.version}</Badge>
            {:else}
              <Badge tone="muted">Running the code baseline</Badge>
            {/if}
          </div>

          <div class="flex flex-col gap-3">
            {#if group.effective?.source === "code"}
              <article class="bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-5 py-4">
                <div class="flex flex-wrap items-center gap-2 mb-3">
                  <span class="font-mono text-xs text-surface-300">Code</span>
                  <Badge tone="neutral">In use</Badge>
                  <span class="text-xs text-surface-400 italic">src/ai/prompts.ts - changeable only by deploy</span>
                </div>
                <pre class="text-xs text-surface-200 bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{group.effective.text}</pre>
              </article>
            {/if}

            {#each group.versions as prompt (prompt.id)}
              {@const full = !!showFullText[prompt.id]}
              <article class="bg-surface-900 border {prompt.active ? 'border-success-700' : 'border-surface-700'} rounded-lg px-4 sm:px-5 py-4">
                <div class="flex flex-wrap items-center gap-2 mb-3">
                  <span class="font-mono text-xs text-surface-300">v{prompt.version}</span>
                  {#if prompt.active}
                    <Badge tone="success">Active</Badge>
                  {:else}
                    <Badge tone="muted">Inactive</Badge>
                  {/if}
                  {#if prompt.changeSummary}
                    <span class="text-xs text-surface-300 italic">{prompt.changeSummary}</span>
                  {/if}
                  <span class="text-xs text-surface-400 sm:ml-auto">{fmtDateTime(prompt.createdAt)}</span>
                  {#if prompt.approvedAt}
                    <span class="text-xs text-surface-400">· approved {fmtDateTime(prompt.approvedAt)}</span>
                  {/if}
                </div>

                <!-- Against whatever is actually running for this section: the active version if
                     there is one, the code baseline otherwise. Approving used to be blind. -->
                {#if !prompt.active && group.effective && group.effective.text !== prompt.promptText && !full}
                  <div class="mb-3">
                    <Diff
                      before={group.effective.text}
                      after={prompt.promptText}
                      beforeLabel={group.effective.source === "db" ? `Active v${group.effective.version}` : "Code baseline"}
                      afterLabel="v{prompt.version}"
                    />
                  </div>
                {:else}
                  <pre class="text-xs text-surface-200 bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto mb-3">{prompt.promptText}</pre>
                {/if}

                {#if !prompt.active && group.effective && group.effective.text !== prompt.promptText}
                  <button
                    type="button"
                    onclick={() => (showFullText[prompt.id] = !full)}
                    class="tap mb-3 px-3 py-1 rounded text-xs border border-surface-700 text-surface-300 hover:bg-surface-800 cursor-pointer"
                  >{full ? "Show the diff" : "Show the full text"}</button>
                {/if}

                {#if !prompt.active}
                  <div class="flex flex-wrap gap-2">
                    <form method="POST" action="?/approve" use:enhance={() => ({ update }) => update({ reset: false })}>
                      <input type="hidden" name="id" value={prompt.id} />
                      <button
                        type="submit"
                        class="tap px-4 py-1.5 rounded text-xs bg-success-800 border border-success-600 text-success-100 hover:bg-success-700 cursor-pointer transition-colors"
                      >Activate</button>
                    </form>
                    <form method="POST" action="?/delete" use:enhance={() => ({ update }) => update({ reset: false })}>
                      <input type="hidden" name="id" value={prompt.id} />
                      <button
                        type="submit"
                        class="tap px-4 py-1.5 rounded text-xs bg-surface-800 border border-surface-500 text-surface-300 hover:text-error-400 hover:border-error-600 cursor-pointer transition-colors"
                      >Delete</button>
                    </form>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</Page>
