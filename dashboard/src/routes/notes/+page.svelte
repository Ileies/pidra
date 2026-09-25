<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import NoteCard from "#lib/notes/NoteCard.svelte";
  import Page from "#lib/components/Page.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { assistant, setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { createNote, deleteNote, restoreNote, updateNote, NOTE_SCOPES } from "#lib/notes/api.js";
  import { filterNotes, type NotesFilter } from "#lib/offline/repo.js";
  import { sync } from "#lib/offline/sync.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { intentIsFor } from "#lib/offline/outbox.js";
  import FailedWrite from "#lib/offline/FailedWrite.svelte";
  import type { PageData } from "./$types";
  import type { NoteRow } from "#lib/notes/api.js";

  let { data }: { data: PageData } = $props();

  // --- filters: applied here, kept in the URL so a view is shareable and survives a reload ---

  const SORTS = ["newest", "oldest", "edited"] as const;
  const VIEWS = ["active", "deleted", "all"] as const;

  function parseFilter(params: Pick<URLSearchParams, "get">): NotesFilter {
    const sort = params.get("sort") ?? "";
    const view = params.get("view") ?? "";
    return {
      scope: params.get("scope") ?? "",
      query: params.get("q") ?? "",
      sort: (SORTS as readonly string[]).includes(sort) ? (sort as NotesFilter["sort"]) : "newest",
      view: (VIEWS as readonly string[]).includes(view) ? (view as NotesFilter["view"]) : "active",
    };
  }

  function searchOf(filter: NotesFilter): string {
    const params = new URLSearchParams();
    if (filter.scope) params.set("scope", filter.scope);
    if (filter.query.trim()) params.set("q", filter.query.trim());
    if (filter.sort !== "newest") params.set("sort", filter.sort);
    if (filter.view !== "active") params.set("view", filter.view);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  // Filtering happens in the component (OFFLINE_PLAN.md §14.3, H2): the load returns every note,
  // so a keystroke re-renders a `$derived` instead of re-running the load, which before H2 also
  // meant a full snapshot pull per keystroke.
  let filter = $state<NotesFilter>(parseFilter(page.url.searchParams));

  // The URL follows the filter without a navigation, so no load runs. A navigation from elsewhere
  // to a different `/notes?...` (a link, the back button) is picked up by the effect below; the
  // box does not fight the user mid-typing, because what we wrote ourselves is recognised.
  let written = page.url.search;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  function writeUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => {
      written = searchOf(filter);
      if (written === page.url.search) return;
      goto(`/notes${written}`, { shallow: true, replace: true, reset: false, state: {} });
    }, 250);
  }

  $effect(() => {
    const search = page.url.search;
    if (search !== written) {
      written = search;
      filter = parseFilter(page.url.searchParams);
    }
  });

  function applyFilters(patch: Partial<NotesFilter>) {
    filter = { ...filter, ...patch };
    writeUrl();
  }

  function onSearchInput(event: Event & { currentTarget: HTMLInputElement }) {
    applyFilters({ query: event.currentTarget.value });
  }

  const shown = $derived(filterNotes(data.notes, filter));

  // A failed create has no row once a pull has put the mirror back to the server's state; it is
  // listed here instead, so it is still seen where it was made.
  const orphanedFailures = $derived(
    offline.failed.filter((i) => i.kind.startsWith("note.") && !data.notes.some((note) => intentIsFor(i, "note", note.id))),
  );
  const counts = $derived({
    active: data.notes.filter((note) => !note.deleted_at).length,
    deleted: data.notes.filter((note) => !!note.deleted_at).length,
  });

  // What the assistant sees of this page. The focus list gives it real ids for the rows on
  // screen, so "the second note from the top" resolves instead of being guessed.
  $effect(() => {
    setPageContext({
      surface: "notes",
      route: "/notes",
      digest: [
        `Notes management. View: ${filter.view === "deleted" ? "trash" : filter.view === "all" ? "all" : "active"}.`,
        `Scope filter: ${filter.scope || "all"}.`,
        filter.query.trim() ? `Search: "${filter.query.trim()}".` : "",
        `${shown.length} of ${counts.active} active notes visible, ${counts.deleted} in the trash.`,
      ].filter(Boolean).join(" "),
      focus: focusFrom(shown, "note", (note) => ({ id: note.id, label: note.content })),
    });
  });

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

  const visibleIds = $derived(shown.map((note) => note.id));
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
      toasts.success(`${ids.length} notes deleted.`, async () => {
        for (const id of ids) await restoreNote(id);
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
      toasts.success("Note deleted.", async () => {
        await restoreNote(note.id);
      });
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRestore(note: NoteRow) {
    try {
      await restoreNote(note.id);
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  }
</script>

<Page title="Notes" size="read" class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2">
    <input
      type="search"
      value={filter.query}
      oninput={onSearchInput}
      placeholder="Search notes…"
      aria-label="Search notes"
      class="input-base flex-1 min-w-40"
    />

    <select
      value={filter.scope}
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
      value={filter.sort}
      onchange={(event) => applyFilters({ sort: event.currentTarget.value as NotesFilter["sort"] })}
      aria-label="Sort order"
      class="input-base"
    >
      <option value="newest">Newest first</option>
      <option value="oldest">Oldest first</option>
      <option value="edited">Last edited</option>
    </select>

    <button
      onclick={() => applyFilters({ view: filter.view === "deleted" ? "active" : "deleted" })}
      aria-pressed={filter.view === "deleted"}
      class="tap px-3 py-1.5 rounded text-sm border cursor-pointer transition-colors {filter.view === 'deleted'
        ? 'bg-surface-800 border-surface-500 text-surface-100'
        : 'bg-surface-900 border-surface-700 text-surface-300 hover:bg-surface-800'}"
    >
      Trash{counts.deleted > 0 ? ` (${counts.deleted})` : ""}
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

  {#each orphanedFailures as intent (intent.id)}
    <FailedWrite {intent} showTarget />
  {/each}

  {#if shown.length === 0}
    <EmptyState
      title={filter.view === "deleted" ? "The trash is empty." : "No notes found."}
      hint={filter.view === "deleted"
        ? undefined
        : "Notes are standing instructions for the briefing: intel and global steer Section 1, personal and global steer Section 2."}
    />
  {:else}
    <div class="flex items-center gap-3 text-xs text-surface-400">
      <label class="tap-check">
        <input type="checkbox" checked={allSelected} onchange={toggleSelectAll} class="accent-primary-600 cursor-pointer h-4 w-4" />
        {shown.length} {shown.length === 1 ? "entry" : "entries"}
      </label>
      {#if filter.view === "deleted"}
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
      {#each shown as note (note.id)}
        <NoteCard
          {note}
          highlighted={assistant.touchedIds.has(note.id)}
          selected={selected.has(note.id)}
          onToggleSelect={toggleSelect}
          onServerChange={() => void sync({ force: true })}
          onDelete={handleDelete}
          onRestore={handleRestore}
        />
      {/each}
    </div>
  {/if}
</Page>
