<script lang="ts">
  import {
    updateNote, noteHistory, revertRevision,
    NOTE_SCOPES, SCOPE_CLASS,
    type NoteRevisionRow,
  } from "$lib/notes/api";
  import { fmtDateTime } from "$lib/format";
  import { label as displayLabel } from "$lib/labels";
  import Spinner from "$lib/components/Spinner.svelte";
  import type { NoteRow } from "../../routes/notes/+page.server";

  interface Props {
    note: NoteRow;
    selected: boolean;
    /** Set while the assistant's last turn touched this note, for the change highlight. */
    highlighted?: boolean;
    onToggleSelect: (id: string, selected: boolean) => void;
    /** A write landed: the page reloads from Postgres. */
    onChanged: () => void;
    onDelete: (note: NoteRow) => void;
    onRestore: (note: NoteRow) => void;
  }

  let {
    note, selected, highlighted = false,
    onToggleSelect, onChanged, onDelete, onRestore,
  }: Props = $props();

  let editing = $state(false);
  let draft = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  // Set on the Cancel button's mousedown, which fires before the textarea's blur. Without it,
  // clicking Cancel would blur-save the very edit it is meant to discard.
  let discarding = false;

  let historyOpen = $state(false);
  let history = $state<NoteRevisionRow[]>([]);
  let historyLoading = $state(false);

  const deleted = $derived(note.deleted_at !== null);

  function startEdit() {
    if (deleted) return;
    draft = note.content;
    error = null;
    editing = true;
  }

  function autosize(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    node.addEventListener("input", fit);
    return { destroy: () => node.removeEventListener("input", fit) };
  }

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (!next || next === note.content) {
      editing = false;
      return;
    }

    saving = true;
    error = null;
    try {
      await updateNote(note.id, { content: next });
      editing = false;
      onChanged();
    } catch (err) {
      // The editor stays open with the text intact: a failed save must not lose the edit.
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function cancel() {
    editing = false;
    error = null;
  }

  function onEditKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  }

  function onEditBlur() {
    if (discarding) {
      discarding = false;
      cancel();
      return;
    }
    if (!saving) commit();
  }

  async function patch(patchBody: Parameters<typeof updateNote>[1]) {
    error = null;
    try {
      await updateNote(note.id, patchBody);
      onChanged();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadHistory() {
    if (historyLoading) return;
    historyLoading = true;
    try {
      history = await noteHistory(note.id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      historyLoading = false;
    }
  }

  async function revert(revisionId: string) {
    error = null;
    try {
      await revertRevision(revisionId);
      historyOpen = false;
      onChanged();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const OPERATION: Record<string, string> = {
    delete: "deleted it",
    restore: "restored it",
    update: "changed it",
  };

  function operationLabel(revision: NoteRevisionRow): string {
    return `${displayLabel(revision.changedBy)} ${OPERATION[revision.operation] ?? "changed it"} · ${fmtDateTime(revision.createdAt)}`;
  }

  function authorLabel(who: string | null): string {
    return displayLabel(who, "The system");
  }
</script>

<div
  class="rounded-lg px-4 sm:px-5 py-4 border transition-colors {deleted
    ? 'bg-surface-950 border-surface-800 opacity-70'
    : 'bg-surface-900 border-surface-700'} {highlighted ? 'ring-2 ring-primary-600' : ''}"
>
  <div class="flex items-start gap-2">
    <label class="tap-check shrink-0 pt-0.5">
      <input
        type="checkbox"
        checked={selected}
        onchange={(event) => onToggleSelect(note.id, event.currentTarget.checked)}
        class="accent-primary-600 cursor-pointer h-4 w-4"
      />
      <span class="sr-only">Select this note</span>
    </label>

    <div class="flex-1 min-w-0">
      {#if editing}
        <textarea
          bind:value={draft}
          use:autosize
          onkeydown={onEditKeydown}
          onblur={onEditBlur}
          disabled={saving}
          aria-label="Note content"
          class="input-base-flush w-full border-primary-700 resize-none disabled:opacity-50"
        ></textarea>
        <div class="flex flex-wrap items-center gap-3 mt-2">
          <button
            onclick={commit}
            disabled={saving}
            class="tap inline-flex items-center gap-2 px-3 py-1 rounded text-xs bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer disabled:opacity-40"
          >{#if saving}<Spinner label="Saving" />{/if}Save</button>
          <button
            onmousedown={() => (discarding = true)}
            onclick={cancel}
            class="tap px-3 py-1 rounded text-xs bg-surface-800 border border-surface-500 text-surface-200 hover:bg-surface-700 cursor-pointer"
          >Cancel</button>
          <span class="text-xs text-surface-400">Ctrl+Enter saves, Esc discards</span>
        </div>
      {:else}
        <button
          onclick={startEdit}
          disabled={deleted}
          title={deleted ? "Restore the note before editing it" : "Click to edit"}
          class="w-full text-left bg-transparent border-none p-0 text-sm whitespace-pre-wrap break-words cursor-text hover:bg-surface-800/40 rounded transition-colors {deleted
            ? 'text-surface-300 line-through cursor-not-allowed'
            : 'text-surface-100'}"
        >{note.content}</button>
      {/if}

      <div class="flex items-center gap-2 mt-3 flex-wrap">
        <select
          value={note.scope}
          onchange={(event) => patch({ scope: event.currentTarget.value })}
          disabled={deleted}
          aria-label="Scope"
          class="tap badge border cursor-pointer disabled:cursor-not-allowed {SCOPE_CLASS[note.scope] ?? 'text-surface-300 bg-surface-900 border-surface-700'}"
        >
          {#each NOTE_SCOPES as scope (scope)}
            <option value={scope}>{scope}</option>
          {/each}
        </select>

        <label class="text-xs text-surface-400 flex items-center gap-1.5">
          Expires
          <input
            type="date"
            value={note.expires_at ?? ""}
            onchange={(event) => patch({ expires_at: event.currentTarget.value || null })}
            disabled={deleted}
            class="input-base-flush"
          />
        </label>

        {#if deleted}
          <button
            onclick={() => onRestore(note)}
            class="tap ml-auto px-3 py-1 rounded text-xs bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
          >Restore</button>
        {:else}
          <button
            onclick={() => onDelete(note)}
            aria-label="Delete this note"
            class="tap ml-auto text-surface-400 hover:text-error-400 transition-colors text-sm cursor-pointer bg-transparent border-none px-2 shrink-0"
          >✕</button>
        {/if}
      </div>

      <p class="text-xs text-surface-400 mt-2">
        {authorLabel(note.created_by)} · {fmtDateTime(note.created_at)}
        {#if note.updated_by}
          · edited by {authorLabel(note.updated_by).toLowerCase()} {fmtDateTime(note.updated_at)}
        {/if}
      </p>

      {#if note.revision_count > 0}
        <details
          bind:open={historyOpen}
          ontoggle={() => historyOpen && history.length === 0 && loadHistory()}
          class="mt-2"
        >
          <summary class="tap text-xs text-surface-400 hover:text-surface-200 cursor-pointer">
            {note.revision_count} {note.revision_count === 1 ? "change" : "changes"}
          </summary>
          {#if historyLoading}
            <p class="text-xs text-surface-400 mt-2"><Spinner /> Loading…</p>
          {:else}
            <div class="flex flex-col gap-2 mt-2">
              {#each history as revision (revision.id)}
                <div class="rounded border border-surface-800 bg-surface-950 px-3 py-2 text-xs">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-surface-400">{operationLabel(revision)}</span>
                    {#if revision.previousContent}
                      <button
                        onclick={() => revert(revision.id)}
                        class="tap ml-auto px-2.5 py-1 rounded bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
                      >Restore this version</button>
                    {/if}
                  </div>
                  {#if revision.previousContent}
                    <p class="text-surface-300 mt-1 whitespace-pre-wrap break-words">{revision.previousContent}</p>
                  {/if}
                  {#if revision.previousScope && revision.previousScope !== note.scope}
                    <p class="text-surface-400 mt-1">Scope was: {revision.previousScope}</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </details>
      {/if}

      {#if error}
        <p class="text-error-400 text-xs mt-2">{error}</p>
      {/if}
    </div>
  </div>
</div>
