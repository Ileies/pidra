<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "#lib/assistant/state.svelte.js";
  import Page from "#lib/components/Page.svelte";
  import WordDiff from "#lib/components/WordDiff.svelte";
  import { fmtDateTime } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import { toastFormResult } from "#lib/toast.svelte.js";
  import { sync } from "#lib/offline/sync.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();


  $effect(() => toastFormResult(form));

  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/context-builder/corrections",
      digest: `${data.corrections.length} active corrections over the harvested long-term context.`,
      focus: data.corrections.slice(0, 30).map((c) => ({
        kind: "context_correction",
        id: c.id,
        label: c.statement.slice(0, 80),
      })),
    });
  });
</script>

<Page title="Corrections" size="app" class="flex flex-col gap-6">
  <div class="flex items-center gap-3 flex-wrap">
    <a href="/context-builder" class="tap nav-btn nav-btn-muted">← Context</a>
    <p class="text-surface-400 text-sm">
      Injected into every briefing alongside the harvest, and authoritative wherever the two
      disagree. The harvest itself is never rewritten.
      <a href="/chat" class="text-primary-400 no-underline hover:text-primary-300">Correct it in the chat →</a>
    </p>
  </div>

  <section class="bg-surface-900 border border-surface-700 rounded-lg p-4 sm:p-5 max-w-read">
    <h1 class="text-surface-100 text-base font-semibold mb-4">Corrections ({data.corrections.length})</h1>

    {#if data.corrections.length === 0}
      <p class="text-surface-300 text-sm">
        No active corrections. A wrong relationship or fact in the document can be fixed in the
        <a href="/chat" class="text-primary-400 no-underline hover:text-primary-300">context chat</a>.
      </p>
    {:else}
      <ul class="flex flex-col gap-4 text-sm">
        {#each data.corrections as correction (correction.id)}
          <li class="border-b border-surface-800 pb-4 last:border-0">
            <div class="flex flex-col gap-2">
              <div class="min-w-0">
                <div class="text-surface-400 text-xs break-all">
                  <code>{correction.target_kind}:{correction.target_key}</code> ·
                  {displayLabel(correction.operation)} · {correction.source}
                </div>
                <!-- One diffed paragraph when there is a prior text to compare against; a pure
                     addition (no supersedes_text) has nothing to diff, so it just reads as new. -->
                <div class="text-surface-100 mt-1">
                  {#if correction.supersedes_text}
                    <WordDiff before={correction.supersedes_text} after={correction.statement} />
                  {:else}
                    <span class="whitespace-pre-wrap break-words">{correction.statement}</span>
                  {/if}
                </div>
                {#if correction.rationale}
                  <div class="text-surface-400 text-xs mt-1 whitespace-pre-wrap break-words">{correction.rationale}</div>
                {/if}
                <div class="text-surface-400 text-xs mt-1">{fmtDateTime(correction.created_at)}</div>
              </div>
              <!-- A revert is written on the server, not through the outbox, so the offline copy this
                   page reads only shows it after a pull; forced, because the throttle would skip it. -->
              <form
                method="POST"
                action="?/revertCorrection"
                use:enhance={() => async ({ update, result }) => {
                  await update();
                  if (result.type === "success") await sync({ force: true });
                }}
              >
                <input type="hidden" name="id" value={correction.id} />
                <button
                  type="submit"
                  disabled={offline.isOffline}
                  title={offline.isOffline ? "Needs the connection" : undefined}
                  class="tap nav-btn nav-btn-muted"
                >Revert</button>
              </form>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</Page>
