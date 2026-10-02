<script lang="ts">
  /**
   * A note's revisions in a sheet instead of inline: an open list inside a card in a column of cards
   * shoved its neighbours around. Each revision is the state *before* a change, shown as a word diff
   * against what the note says now, so "Restore this version" reads as exactly what it will do.
   * Online-only, as before: a revert replayed later would land on whatever the note has become.
   */
  import { noteHistory, revertRevision, type NoteRevisionRow, type NoteRow } from "#lib/notes/api.js";
  import { fmtDateTime } from "#lib/format.js";
  import { label as displayLabel } from "#lib/labels.js";
  import Sheet from "#lib/components/Sheet.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import WordDiff from "#lib/components/WordDiff.svelte";

  interface Props {
    /** The note whose history to show, or null when closed. */
    note: NoteRow | null;
    onclose: () => void;
    /** A revert went to the server directly, so the mirror needs a fresh pull to show it. */
    onreverted: () => void;
  }

  let { note, onclose, onreverted }: Props = $props();

  let history = $state<NoteRevisionRow[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let reverting = $state<string | null>(null);

  const noteId = $derived(note?.id ?? null);

  $effect(() => {
    const id = noteId;
    history = [];
    error = null;
    if (!id) return;
    loading = true;
    let cancelled = false;
    noteHistory(id)
      .then((rows) => { if (!cancelled) history = rows; })
      .catch((err) => { if (!cancelled) error = err instanceof Error ? err.message : String(err); })
      .finally(() => { if (!cancelled) loading = false; });
    return () => { cancelled = true; };
  });

  const OPERATION: Record<string, string> = {
    delete: "deleted it",
    restore: "restored it",
    update: "changed it",
  };

  async function revert(revisionId: string) {
    if (reverting) return;
    reverting = revisionId;
    error = null;
    try {
      await revertRevision(revisionId);
      onreverted();
      onclose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      reverting = null;
    }
  }
</script>

<Sheet open={note !== null} title="History" {onclose}>
  {#if loading}
    <p class="flex items-center gap-2 text-xs text-surface-400"><Spinner /> Loading…</p>
  {:else if error}
    <p class="text-xs text-error-400">{error}</p>
  {/if}

  {#if !loading && history.length === 0 && !error}
    <p class="text-xs text-surface-400">No earlier versions.</p>
  {/if}

  <div class="flex flex-col gap-3">
    {#each history as revision (revision.id)}
      <div class="rounded border border-surface-800 bg-surface-950 px-3 py-2.5 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-surface-400">
            {displayLabel(revision.changedBy)} {OPERATION[revision.operation] ?? "changed it"} · {fmtDateTime(revision.createdAt)}
          </span>
          {#if revision.previousContent}
            <button
              type="button"
              onclick={() => revert(revision.id)}
              disabled={reverting !== null}
              class="tap ml-auto rounded border border-surface-500 bg-surface-800 px-2.5 py-1 text-surface-100 hover:bg-surface-700 cursor-pointer disabled:opacity-40"
            >Restore this version</button>
          {/if}
        </div>
        {#if revision.previousContent}
          <p class="mt-2 text-sm text-surface-200">
            {#if note && revision.previousContent !== note.content}
              <WordDiff before={note.content} after={revision.previousContent} />
            {:else}
              <span class="whitespace-pre-wrap [overflow-wrap:anywhere]">{revision.previousContent}</span>
            {/if}
          </p>
        {/if}
        {#if revision.previousScope && note && revision.previousScope !== note.scope}
          <p class="mt-1 text-surface-400">Scope was: {displayLabel(revision.previousScope)}</p>
        {/if}
      </div>
    {/each}
  </div>
</Sheet>
