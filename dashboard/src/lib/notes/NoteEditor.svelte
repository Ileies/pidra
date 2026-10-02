<script lang="ts">
  /**
   * The one editor, for a new note and for an open card. Scope and expiry are part of the draft, so
   * a tidy-up is one save and one revision rather than three. Nothing is saved on blur: the draft
   * stays open (and survives a re-render, since the page owns it) until Save or Cancel.
   */
  import { NOTE_SCOPES, SCOPE_INFO, SCOPE_FALLBACK_CLASS, type Draft } from "#lib/notes/api.js";
  import { label } from "#lib/labels.js";
  import { isoDay } from "#lib/format.js";
  import Spinner from "#lib/components/Spinner.svelte";
  import Trash from "@lucide/svelte/icons/trash";

  interface Props {
    draft: Draft;
    /** Whether the draft differs from what is stored; drives the "Unsaved" marker. */
    dirty: boolean;
    /** Present when editing an existing note. */
    existing?: { revisionCount: number };
    onSave: () => void;
    onCancel: () => void;
    onDelete?: () => void;
    onHistory?: () => void;
  }

  let { draft = $bindable(), dirty, existing, onSave, onCancel, onDelete, onHistory }: Props = $props();

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

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave();
    }
  }

  function expiresIn(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    draft.expires = isoDay(date);
  }

  const empty = $derived(draft.content.trim() === "");
</script>

<div class="flex flex-col gap-3 px-4 py-4 sm:px-5">
  <textarea
    bind:value={draft.content}
    use:autosize
    onkeydown={onKeydown}
    disabled={draft.saving}
    rows="3"
    placeholder="What should every briefing know?"
    aria-label={existing ? "Note content" : "New note content"}
    class="input-base-flush w-full resize-none border-primary-700 disabled:opacity-50"
  ></textarea>

  <div class="flex flex-col gap-1.5">
    <div role="radiogroup" aria-label="Scope" class="flex flex-wrap gap-1.5">
      {#each NOTE_SCOPES as scope (scope)}
        {@const active = draft.scope === scope}
        <button
          type="button"
          role="radio"
          aria-checked={active}
          onclick={() => (draft.scope = scope)}
          disabled={draft.saving}
          class="tap badge border cursor-pointer transition-colors {active
            ? (SCOPE_INFO[scope]?.classes ?? SCOPE_FALLBACK_CLASS)
            : 'text-surface-400 bg-transparent border-surface-700 hover:bg-surface-800'}"
        >{label(scope)}</button>
      {/each}
    </div>
    <p class="text-xs text-surface-400">{SCOPE_INFO[draft.scope]?.hint ?? ""}</p>
  </div>

  <div class="flex flex-wrap items-center gap-2 text-xs text-surface-400">
    <label class="flex items-center gap-2">
      Expires
      <input type="date" bind:value={draft.expires} disabled={draft.saving} class="input-base-flush" />
    </label>
    <button
      type="button"
      onclick={() => expiresIn(7)}
      class="tap rounded border border-surface-700 bg-surface-900 px-2.5 py-1 text-surface-300 hover:bg-surface-800 cursor-pointer"
    >+1 week</button>
    <button
      type="button"
      onclick={() => expiresIn(30)}
      class="tap rounded border border-surface-700 bg-surface-900 px-2.5 py-1 text-surface-300 hover:bg-surface-800 cursor-pointer"
    >+1 month</button>
    {#if draft.expires}
      <button
        type="button"
        onclick={() => (draft.expires = "")}
        class="tap rounded border border-surface-700 bg-surface-900 px-2.5 py-1 text-surface-300 hover:bg-surface-800 cursor-pointer"
      >No expiry</button>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onclick={onSave}
      disabled={draft.saving || empty}
      class="tap inline-flex items-center gap-2 rounded border border-primary-700 bg-primary-900 px-4 py-1.5 text-sm text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >{#if draft.saving}<Spinner label="Saving" />{/if}{existing ? "Save" : "Add"}</button>
    <button
      type="button"
      onclick={onCancel}
      disabled={draft.saving}
      class="tap rounded border border-surface-500 bg-surface-800 px-3 py-1.5 text-sm text-surface-200 hover:bg-surface-700 cursor-pointer disabled:opacity-40"
    >Cancel</button>
    {#if dirty && !draft.saving}
      <span class="text-xs text-warning-400">Unsaved</span>
    {/if}
    <span class="hidden text-xs text-surface-400 sm:inline">Ctrl+Enter saves, Esc discards</span>

    {#if existing}
      <span class="ml-auto flex items-center gap-1">
        {#if existing.revisionCount > 0 && onHistory}
          <button
            type="button"
            onclick={onHistory}
            class="tap rounded bg-transparent px-2 text-xs text-surface-400 hover:text-surface-100 cursor-pointer border-none"
          >{existing.revisionCount} {existing.revisionCount === 1 ? "change" : "changes"}</button>
        {/if}
        {#if onDelete}
          <button
            type="button"
            onclick={onDelete}
            aria-label="Delete this note"
            class="tap inline-flex items-center justify-center rounded bg-transparent px-2 text-surface-400 hover:text-error-400 cursor-pointer border-none transition-colors"
          ><Trash class="h-4 w-4" aria-hidden="true" /></button>
        {/if}
      </span>
    {/if}
  </div>

  {#if draft.error}
    <p class="text-xs text-error-400">{draft.error}</p>
  {/if}
</div>
