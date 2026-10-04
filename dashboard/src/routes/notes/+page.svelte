<script lang="ts">
  import { errMessage } from "$pipeline/util/text";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import NoteCard from "#lib/notes/NoteCard.svelte";
  import NoteEditor from "#lib/notes/NoteEditor.svelte";
  import NoteHistory from "#lib/notes/NoteHistory.svelte";
  import NotesToolbar from "#lib/notes/NotesToolbar.svelte";
  import BulkBar from "#lib/notes/BulkBar.svelte";
  import { useNoteDrafts } from "#lib/notes/useNoteDrafts.svelte.js";
  import { useNoteSelection } from "#lib/notes/useNoteSelection.svelte.js";
  import Masonry from "#lib/components/Masonry.svelte";
  import Page from "#lib/components/Page.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import { assistant, setPageContext } from "#lib/assistant/state.svelte.js";
  import { focusFrom } from "#lib/assistant/pageContext.js";
  import { toasts } from "#lib/toast.svelte.js";
  import { deleteNote, restoreNote, type NoteRow } from "#lib/notes/api.js";
  import { filterNotes, NOTES_SHOWN, type NotesFilter } from "#lib/offline/repo.js";
  import { sync } from "#lib/offline/sync.js";
  import { offline } from "#lib/offline/state.svelte.js";
  import { intentIsFor } from "#lib/offline/outbox.js";
  import FailedWrite from "#lib/offline/FailedWrite.svelte";
  import type { PageData } from "./$types";

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

  // Filtering happens in the component: the load returns every note,
  // so a keystroke re-renders a `$derived` instead of re-running the load, which used to also
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

  const shown = $derived(filterNotes(data.notes, filter));

  // A failed create has no row once a pull has put the mirror back to the server's state; it is
  // listed here instead, so it is still seen where it was made.
  const orphanedFailures = $derived(
    offline.failed.filter((i) => i.kind.startsWith("note.") && !data.notes.some((note) => intentIsFor(i, "note", note.id))),
  );
  // One pass: the trash and active totals, and per-scope counts for the view being looked at.
  const counts = $derived.by(() => {
    const scopes: Record<string, number> = {};
    let active = 0;
    let deleted = 0;
    for (const note of data.notes) {
      if (note.deleted_at) deleted++;
      else active++;
      if (filter.view === "deleted" ? !note.deleted_at : !!note.deleted_at) continue;
      scopes[note.scope] = (scopes[note.scope] ?? 0) + 1;
    }
    return { active, deleted, scopes };
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

  const editing = useNoteDrafts();
  const selection = useNoteSelection(() => shown.map((note) => note.id));

  function startNew() {
    if (filter.view === "deleted") applyFilters({ view: "active" });
    editing.startNew(filter.scope || "global");
  }

  let historyId = $state<string | null>(null);
  const historyNote = $derived(historyId ? (data.notes.find((note) => note.id === historyId) ?? null) : null);

  // --- single delete and restore, with undo ---

  async function handleDelete(note: NoteRow) {
    delete editing.drafts[note.id];
    try {
      await deleteNote(note.id);
      toasts.success("Note deleted.", async () => {
        await restoreNote(note.id);
      });
    } catch (err) {
      toasts.error(errMessage(err));
    }
  }

  async function handleRestore(note: NoteRow) {
    try {
      await restoreNote(note.id);
    } catch (err) {
      toasts.error(errMessage(err));
    }
  }
</script>

{#snippet composerCard()}
  {#if editing.composing && filter.view !== "deleted"}
    <div class="rounded-lg border border-primary-700 bg-surface-900">
      <NoteEditor
        bind:draft={editing.composer}
        dirty={editing.composer.content.trim() !== ""}
        onSave={editing.saveNew}
        onCancel={() => (editing.composing = false)}
      />
    </div>
  {/if}
{/snippet}

<Page title="Notes" size="app" class="flex flex-col gap-4">
  <NotesToolbar
    {filter}
    scopeCounts={counts.scopes}
    trashCount={counts.deleted}
    selecting={selection.selecting}
    onchange={applyFilters}
    onNew={startNew}
    onToggleSelecting={() => (selection.selecting ? selection.end() : (selection.selecting = true))}
  />

  {#each orphanedFailures as intent (intent.id)}
    <FailedWrite {intent} showTarget />
  {/each}

  {#if shown.length === 0 && !(editing.composing && filter.view !== "deleted")}
    {#if filter.view === "deleted"}
      <EmptyState title="The trash is empty." />
    {:else if counts.active === 0}
      <EmptyState title="No notes yet." hint="Notes are standing instructions for the briefing.">
        <button
          type="button"
          onclick={startNew}
          class="btn btn-md btn-primary mt-2"
        >Write the first note</button>
      </EmptyState>
    {:else}
      <EmptyState title="No notes match." hint="Try another search or scope." />
    {/if}
  {:else}
    <Masonry items={shown} key={(note) => note.id} lead={composerCard}>
      {#snippet children(note)}
        <NoteCard
          {note}
          highlighted={assistant.touchedIds.has(note.id)}
          selected={selection.has(note.id)}
          selecting={selection.active}
          bind:draft={editing.drafts[note.id]}
          onEdit={editing.startEdit}
          onToggleSelect={selection.toggle}
          onSave={editing.saveEdit}
          onCancel={editing.cancelEdit}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onHistory={(target) => (historyId = target.id)}
        />
      {/snippet}
    </Masonry>

    {#if shown.length >= NOTES_SHOWN}
      <p class="text-center text-xs text-surface-400">Showing the first {NOTES_SHOWN}. Search or pick a scope to narrow it down.</p>
    {/if}
  {/if}
</Page>

<NoteHistory
  note={historyNote}
  onclose={() => (historyId = null)}
  onreverted={() => void sync({ force: true })}
/>

{#if selection.count > 0}
  <BulkBar {selection} view={filter.view} />
{/if}
