<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import NoteCard from "$lib/notes/NoteCard.svelte";
  import { assistant, setPageContext } from "$lib/assistant/state.svelte";
  import { focusFrom } from "$lib/assistant/pageContext";
  import {
    createNote, deleteNote, restoreNote, updateNote,
    NOTE_SCOPES,
  } from "$lib/notes/api";
  import type { PageData } from "./$types";
  import type { NoteRow } from "./+page.server";

  let { data }: { data: PageData } = $props();

  // What the assistant sees of this page. The focus list gives it real ids for the rows on
  // screen, so "die zweite Note von oben" resolves instead of being guessed.
  $effect(() => {
    setPageContext({
      surface: "notes",
      route: "/notes",
      digest: [
        `Notes-Verwaltung. Ansicht: ${data.view === "deleted" ? "Papierkorb" : data.view === "all" ? "alle" : "aktive"}.`,
        `Scope-Filter: ${data.scopeFilter || "alle"}.`,
        data.query ? `Suche: "${data.query}".` : "",
        `${data.notes.length} von ${data.counts.active} aktiven Notes sichtbar, ${data.counts.deleted} im Papierkorb.`,
      ].filter(Boolean).join(" "),
      focus: focusFrom(data.notes, "note", (note) => ({ id: note.id, label: note.content })),
    });
  });
  const inputClass =
    "px-3 py-1.5 rounded text-sm bg-surface-900 border border-surface-700 text-surface-200 placeholder-surface-600 focus:border-surface-500";

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
    goto(query ? `/notes?${query}` : "/notes", { keepFocus: true, noScroll: true, replaceState: true });
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
  let error = $state<string | null>(null);

  async function submitNew() {
    const content = newContent.trim();
    if (!content || creating) return;

    creating = true;
    error = null;
    try {
      await createNote({ content, scope: newScope, expires_at: newExpires || null });
      newContent = "";
      newExpires = "";
      adding = false;
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
    error = null;
    const ids = [...selected];
    try {
      for (const id of ids) await updateNote(id, { scope });
      selected = new Set();
      await invalidateAll();
      showToast(`${ids.length} Notes auf "${scope}" gesetzt.`, null);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function bulkDelete() {
    if (busy) return;
    busy = true;
    error = null;
    const ids = [...selected];
    try {
      for (const id of ids) await deleteNote(id);
      selected = new Set();
      await invalidateAll();
      showToast(`${ids.length} Notes gelöscht.`, async () => {
        for (const id of ids) await restoreNote(id);
        await invalidateAll();
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  // --- single delete and restore, with undo ---

  async function handleDelete(note: NoteRow) {
    error = null;
    try {
      await deleteNote(note.id);
      await invalidateAll();
      showToast("Note gelöscht.", async () => {
        await restoreNote(note.id);
        await invalidateAll();
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRestore(note: NoteRow) {
    error = null;
    try {
      await restoreNote(note.id);
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // --- toast: the undo affordance for the one destructive action here ---

  let toast = $state<{ message: string; undo: (() => Promise<void>) | null } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(message: string, undo: (() => Promise<void>) | null) {
    clearTimeout(toastTimer);
    toast = { message, undo };
    toastTimer = setTimeout(() => (toast = null), 8000);
  }

  async function runUndo() {
    const action = toast?.undo;
    toast = null;
    clearTimeout(toastTimer);
    if (!action) return;
    try {
      await action();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<svelte:head>
  <title>PIDRA - Notes</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
  <main class="flex-1 max-w-3xl w-full mx-auto px-8 py-6 pb-24">
    <div class="flex flex-wrap items-center gap-2 mb-6">
      <input
        type="search"
        value={search}
        oninput={onSearchInput}
        placeholder="Notes durchsuchen…"
        class="{inputClass} flex-1 min-w-40"
      />

      <select
        value={data.scopeFilter}
        onchange={(event) => applyFilters({ scope: event.currentTarget.value })}
        aria-label="Scope filtern"
        class={inputClass}
      >
        <option value="">Alle Scopes</option>
        {#each NOTE_SCOPES as scope}
          <option value={scope}>{scope}</option>
        {/each}
      </select>

      <select
        value={data.sort}
        onchange={(event) => applyFilters({ sort: event.currentTarget.value })}
        aria-label="Sortierung"
        class={inputClass}
      >
        <option value="newest">Neueste zuerst</option>
        <option value="oldest">Älteste zuerst</option>
        <option value="edited">Zuletzt bearbeitet</option>
      </select>

      <button
        onclick={() => applyFilters({ view: data.view === "deleted" ? "active" : "deleted" })}
        class="px-3 py-1.5 rounded text-sm border cursor-pointer transition-colors {data.view === 'deleted'
          ? 'bg-surface-800 border-surface-500 text-surface-100'
          : 'bg-surface-900 border-surface-700 text-surface-400 hover:bg-surface-800'}"
      >
        Papierkorb{data.counts.deleted > 0 ? ` (${data.counts.deleted})` : ""}
      </button>

      <button
        onclick={() => (adding = !adding)}
        class="px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer transition-colors"
      >
        {adding ? "Abbrechen" : "+ Neue Note"}
      </button>
    </div>

    {#if adding}
      <div class="bg-surface-900 border border-surface-700 rounded-lg px-5 py-4 mb-6 flex flex-col gap-3">
        <textarea
          bind:value={newContent}
          rows="3"
          placeholder="Note content…"
          onkeydown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submitNew();
            }
          }}
          class="w-full px-3 py-2 rounded text-sm bg-surface-950 border border-surface-700 text-surface-100 placeholder-surface-600 focus:border-surface-500 resize-y"
        ></textarea>
        <div class="flex items-center gap-3 flex-wrap">
          <select bind:value={newScope} aria-label="Scope" class={inputClass}>
            {#each NOTE_SCOPES as scope}
              <option value={scope}>{scope}</option>
            {/each}
          </select>
          <label class="text-xs text-surface-500 flex items-center gap-2">
            läuft ab
            <input type="date" bind:value={newExpires} class={inputClass} />
          </label>
          <button
            onclick={submitNew}
            disabled={creating || newContent.trim() === ""}
            class="px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? "…" : "Hinzufügen"}
          </button>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="rounded-lg border border-error-800 bg-surface-900 px-4 py-3 text-sm text-error-400 mb-4">{error}</div>
    {/if}

    {#if data.notes.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">
        {data.view === "deleted" ? "Papierkorb ist leer." : "Keine Notes gefunden."}
      </p>
    {:else}
      <div class="flex items-center gap-3 mb-3 text-xs text-surface-600">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onchange={toggleSelectAll}
            class="accent-primary-600 cursor-pointer"
          />
          {data.notes.length} {data.notes.length === 1 ? "Eintrag" : "Einträge"}
        </label>
        {#if data.view === "deleted"}
          <span class="text-surface-500">Papierkorb: gelöschte Notes beeinflussen kein Briefing mehr.</span>
        {/if}
      </div>

      {#if selectedCount > 0}
        <div class="flex items-center gap-3 flex-wrap bg-surface-800 border border-surface-600 rounded-lg px-4 py-2 mb-3 text-sm sticky top-14 z-10">
          <span class="text-surface-200">{selectedCount} ausgewählt</span>
          <select
            value=""
            onchange={(event) => {
              const scope = event.currentTarget.value;
              event.currentTarget.value = "";
              bulkScope(scope);
            }}
            disabled={busy}
            aria-label="Scope für Auswahl setzen"
            class="px-2 py-1 rounded text-xs bg-surface-950 border border-surface-600 text-surface-200"
          >
            <option value="">Scope setzen…</option>
            {#each NOTE_SCOPES as scope}
              <option value={scope}>{scope}</option>
            {/each}
          </select>
          <button
            onclick={bulkDelete}
            disabled={busy}
            class="px-3 py-1 rounded text-xs bg-surface-900 border border-error-800 text-error-400 hover:bg-surface-950 cursor-pointer disabled:opacity-40"
          >Löschen</button>
          <button
            onclick={() => (selected = new Set())}
            class="ml-auto px-3 py-1 rounded text-xs bg-surface-900 border border-surface-600 text-surface-300 hover:bg-surface-950 cursor-pointer"
          >Auswahl aufheben</button>
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
  </main>

  {#if toast}
    <div
      role="status"
      aria-live="polite"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 rounded-lg bg-surface-800 border border-surface-600 px-4 py-2 text-sm text-surface-100 shadow-lg"
    >
      <span>{toast.message}</span>
      {#if toast.undo}
        <button
          onclick={runUndo}
          class="px-2 py-0.5 rounded text-xs bg-surface-950 border border-primary-700 text-primary-300 hover:bg-surface-900 cursor-pointer"
        >Rückgängig</button>
      {/if}
    </div>
  {/if}
</div>
