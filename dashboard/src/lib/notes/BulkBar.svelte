<script lang="ts">
  /** Fixed above the mobile tab bar (3.5rem plus the safe area), centred on desktop. */
  import { NOTE_SCOPES, deleteNote, restoreNote, updateNote } from "#lib/notes/api.js";
  import type { NoteSelection } from "#lib/notes/useNoteSelection.svelte.js";
  import { label } from "#lib/labels.js";

  let { selection, view }: { selection: NoteSelection; view: string } = $props();

  function setScope(scope: string) {
    if (scope) void selection.runBulk((id) => updateNote(id, { scope }), `set to "${scope}"`);
  }
</script>

<div
  role="toolbar"
  aria-label="Selected notes"
  class="fixed inset-x-3 bottom-[calc(4.25rem+var(--safe-b))] z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-lg border border-surface-500 bg-surface-800 px-3 py-2 text-sm shadow-2xl lg:bottom-6"
>
  <span class="px-1 text-surface-100">{selection.count} selected</span>
  <button
    type="button"
    onclick={selection.toggleAll}
    class="btn btn-sm border-surface-500 bg-surface-900 text-surface-200 hover:bg-surface-950"
  >{selection.all ? "Select none" : "Select all"}</button>

  {#if view === "deleted"}
    <button
      type="button"
      onclick={() => selection.runBulk(restoreNote, "restored")}
      disabled={selection.busy}
      class="btn btn-sm border-surface-500 bg-surface-900 text-surface-100 hover:bg-surface-950"
    >Restore</button>
  {:else}
    <select
      value=""
      onchange={(event) => {
        const scope = event.currentTarget.value;
        event.currentTarget.value = "";
        setScope(scope);
      }}
      disabled={selection.busy}
      aria-label="Set scope for the selection"
      class="input-base bg-surface-950"
    >
      <option value="">Set scope…</option>
      {#each NOTE_SCOPES as scope (scope)}
        <option value={scope}>{label(scope)}</option>
      {/each}
    </select>
    <button
      type="button"
      onclick={() => selection.runBulk(deleteNote, "deleted", restoreNote)}
      disabled={selection.busy}
      class="btn btn-sm btn-danger"
    >Delete</button>
  {/if}

  <button
    type="button"
    onclick={selection.end}
    class="btn btn-sm ml-auto border-surface-500 bg-surface-900 text-surface-200 hover:bg-surface-950"
  >Done</button>
</div>
