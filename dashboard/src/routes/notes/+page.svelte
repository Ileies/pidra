<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import NoteCard from "#lib/notes/NoteCard.svelte";
  import Page from "#lib/components/Page.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { assistant, setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { createNote, deleteNote, restoreNote, updateNote, NOTE_SCOPES } from "#lib/notes/api.js";
  import type { PageData } from "./$types";
  import type { NoteRow } from "#lib/notes/api.js";

  let { data }: { data: PageData } = $props();

  // What the assistant sees of this page. The focus list gives it real ids for the rows on
  // screen, so "the second note from the top" resolves instead of being guessed.
  $effect(() => {
    setPageContext({
      surface: "notes",
      route: "/notes",
      digest: [
        `Notes management. View: ${data.view === "deleted" ? "trash" : data.view === "all" ? "all" : "active"}.`,
        `Scope filter: ${data.scopeFilter || "all"}.`,
        data.query ? `Search: "${data.query}".` : "",
        `${data.notes.length} of ${data.counts.active} active notes visible, ${data.counts.deleted} in the trash.`,
      ].filter(Boolean).join(" "),
      focus: focusFrom(data.notes, "note", (note) => ({ id: note.id, label: note.content })),
    });
  });

  // --- filters, kept in the URL so a view is shareable and survives a reload ---

  let search = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  // The URL is the source of truth, but the box must not fight the user mid-typing: it only
  // re-syncs when the server-side query actually changed (first load, back button, a link).
  let appliedQuery = "";
  $effect(() => {
    if (data.query !== appliedQuery) {
      appliedQuery = data.query;
      search = data.query;
    }
  });

  function applyFilters(patch: Partial<{ scope: string; q: string; sort: string; view: string }>) {
    const params = new URLSearchParams();
    const next = {
      scope: patch.scope ?? data.scopeFilter,
      q: patch.q ?? search,
      sort: patch.sort ?? data.sort,
      view: patch.view ?? data.view,
    };
    if (next.scope) params.set("scope", next.scope);
    if (next.q.trim()) params.set("q", next.q.trim());
    if (next.sort !== "newest") params.set("sort", next.sort);
    if (next.view !== "active") params.set("view", next.view);

    const query = params.toString();
    goto(query ? `/notes?${query}` : "/notes", { reset: false, replaceState: true });
  }

  function onSearchInput(event: Event & { currentTarget: HTMLInputElement }) {
    search = event.currentTarget.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters({ q: search }), 250);
  }

  // --- add ---

  let adding = $state(false);
  let newContent = $state("");
  let newScope = $state("global");
  let newExpires = $state("");
  let creating = $state(false);

  async function submitNew() {
    const content = newContent.trim();
    if (!content || creating) return;

    creating = true;
    try {
      await createNote({ content, scope: newScope, expires_at: newExpires || null });
      newContent = "";
      newExpires = "";
      adding = false;
      await invalidateAll();
      toasts.success("Note added.");
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      creating = false;
    }
  }

  // --- selection and bulk actions ---

  let selected = $state<Set<string>>(new Set());
  let busy = $state(false);

  const visibleIds = $derived(data.notes.map((note) => note.id));
  const selectedCount = $derived(selected.size);
  const allSelected = $derived(visibleIds.length > 0 && visibleIds.every((id) => selected.has(id)));

  // A filter change can hide selected rows; acting on invisible selection is a nasty surprise.
  $effect(() => {
    const visible = new Set(visibleIds);
    if ([...selected].some((id) => !visible.has(id))) {
      selected = new Set([...selected].filter((id) => visible.has(id)));
    }
  });

  function toggleSelect(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    selected = next;
  }

  function toggleSelectAll() {
    selected = allSelected ? new Set() : new Set(visibleIds);
  }

  async function bulkScope(scope: string) {
    if (!scope || busy) return;
    busy = true;
    const ids = [...selected];
    try {
      for (const id of ids) await updateNote(id, { scope });
      selected = new Set();
      await invalidateAll();
      toasts.success(`${ids.length} notes set to "${scope}".`);
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function bulkDelete() {
    if (busy) return;
    busy = true;
    const ids = [...selected];
    try {
      for (const id of ids) await deleteNote(id);
      selected = new Set();
      await invalidateAll();
      toasts.success(`${ids.length} notes deleted.`, async () => {
        for (const id of ids) await restoreNote(id);
        await invalidateAll();
      });
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  // --- single delete and restore, with undo ---

  async function handleDelete(note: NoteRow) {
    try {
      await deleteNote(note.id);
      await invalidateAll();
      toasts.success("Note deleted.", async () => {
        await restoreNote(note.id);
        await invalidateAll();
      });
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestore(note: NoteRow) {
    try {
      await restoreNote(note.id);
      await invalidateAll();
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  }
</script>

<Page title="Notes" size="read" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      value={search}
      oninput={onSearchInput}
      placeholder="Search notes…"
      aria-label="Search notes"
      class="input-base flex-1 min-w-40"
    />

    <select
      value={data.scopeFilter}
      onchange={(event) => applyFilters({ scope: event.currentTarget.value })}
      aria-label="Filter by scope"
      class="input-base"
    >
      <option value="">All scopes</option>
      {#each NOTE_SCOPES as scope (scope)}
        <option value={scope}>{scope}</option>
      {/each}
    </select>

    <select
      value={data.sort}
      onchange={(event) => applyFilters({ sort: event.currentTarget.value })}
      aria-label="Sort order"
      class="input-base"
    >
      <option value="newest">Newest first</option>
      <option value="oldest">Oldest first</option>
      <option value="edited">Last edited</option>
    </select>

    <button
      onclick={() => applyFilters({ view: data.view === "deleted" ? "active" : "deleted" })}
      aria-pressed={data.view === "deleted"}
      class="tap px-3 py-1.5 rounded text-sm border cursor-pointer transition-colors {data.view === 'deleted'
        ? 'bg-surface-800 border-surface-500 text-surface-100'
        : 'bg-surface-900 border-surface-700 text-surface-300 hover:bg-surface-800'}"
    >
      Trash{data.counts.deleted > 0 ? ` (${data.counts.deleted})` : ""}
    </button>

    <button
      onclick={() => (adding = !adding)}
      class="tap px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
    >
      {adding ? "Cancel" : "+ New note"}
    </button>
  </div>

  {#if adding}
    <div class="bg-surface-900 border border-surface-700 rounded-lg px-4 sm:px-5 py-4 flex flex-col gap-3">
      <textarea
        bind:value={newContent}
        rows="3"
        placeholder="Note content…"
        aria-label="New note content"
        onkeydown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submitNew();
          }
        }}
        class="input-base-flush w-full resize-y"
      ></textarea>
      <div class="flex items-center gap-3 flex-wrap">
        <select bind:value={newScope} aria-label="Scope" class="input-base">
          {#each NOTE_SCOPES as scope (scope)}
            <option value={scope}>{scope}</option>
          {/each}
        </select>
        <label class="text-xs text-surface-400 flex items-center gap-2">
          Expires
          <input type="date" bind:value={newExpires} class="input-base" />
        </label>
        <button
          onclick={submitNew}
          disabled={creating || newContent.trim() === ""}
          class="tap inline-flex items-center gap-2 px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {#if creating}<Spinner label="Adding" />{/if}Add
        </button>
      </div>
    </div>
  {/if}

  {#if data.notes.length === 0}
    <EmptyState
      title={data.view === "deleted" ? "The trash is empty." : "No notes found."}
      hint={data.view === "deleted"
        ? undefined
        : "Notes are standing instructions for the briefing: intel and global steer Section 1, personal and global steer Section 2."}
    />
  {:else}
    <div class="flex items-center gap-3 text-xs text-surface-400">
      <label class="tap-check">
        <input type="checkbox" checked={allSelected} onchange={toggleSelectAll} class="accent-primary-600 cursor-pointer h-4 w-4" />
        {data.notes.length} {data.notes.length === 1 ? "entry" : "entries"}
      </label>
      {#if data.view === "deleted"}
        <span>Trash: deleted notes no longer influence a briefing.</span>
      {/if}
    </div>

    {#if selectedCount > 0}
      <!-- Anchored to the measured header height, not a hard-coded 56px (X6, M8). -->
      <div
        class="flex items-center gap-3 flex-wrap bg-surface-800 border border-surface-500 rounded-lg px-4 py-2 text-sm sticky z-20"
        style="top: calc(var(--header-h) + 0.5rem)"
      >
        <span class="text-surface-100">{selectedCount} selected</span>
        <select
          value=""
          onchange={(event) => {
            const scope = event.currentTarget.value;
            event.currentTarget.value = "";
            bulkScope(scope);
          }}
          disabled={busy}
          aria-label="Set scope for the selection"
          class="input-base bg-surface-950"
        >
          <option value="">Set scope…</option>
          {#each NOTE_SCOPES as scope (scope)}
            <option value={scope}>{scope}</option>
          {/each}
        </select>
        <button
          onclick={bulkDelete}
          disabled={busy}
          class="tap px-3 py-1 rounded text-xs bg-surface-900 border border-error-700 text-error-400 hover:bg-surface-950 cursor-pointer disabled:opacity-40"
        >Delete</button>
        <button
          onclick={() => (selected = new Set())}
          class="tap ml-auto px-3 py-1 rounded text-xs bg-surface-900 border border-surface-500 text-surface-200 hover:bg-surface-950 cursor-pointer"
        >Clear selection</button>
      </div>
    {/if}

    <div class="flex flex-col gap-3">
      {#each data.notes as note (note.id)}
        <NoteCard
          {note}
          highlighted={assistant.touchedIds.has(note.id)}
          selected={selected.has(note.id)}
          onToggleSelect={toggleSelect}
          onChanged={invalidateAll}
          onDelete={handleDelete}
          onRestore={handleRestore}
        />
      {/each}
    </div>
  {/if}
</Page>
