<script lang="ts">
  /**
   * Search and New note on the first row; scope chips, sort, Select and the Notes/Trash switch on the
   * second. Trash is a view, not a filter, so it is a segmented control rather than one more button in
   * a row of filters. The line under the chips says what the chosen scope does to the briefing.
   */
  import { NOTE_SCOPES, SCOPE_INFO } from "#lib/notes/api.js";
  import { label } from "#lib/labels.js";
  import type { NotesFilter } from "#lib/offline/repo.js";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import Plus from "@lucide/svelte/icons/plus";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import ListChecks from "@lucide/svelte/icons/list-checks";

  interface Props {
    filter: NotesFilter;
    /** Notes in the current view, by scope, ignoring the scope and search filters. */
    scopeCounts: Record<string, number>;
    trashCount: number;
    selecting: boolean;
    onchange: (patch: Partial<NotesFilter>) => void;
    onNew: () => void;
    onToggleSelecting: () => void;
  }

  let { filter, scopeCounts, trashCount, selecting, onchange, onNew, onToggleSelecting }: Props = $props();

  const SORT_LABEL: Record<NotesFilter["sort"], string> = {
    newest: "Newest first",
    oldest: "Oldest first",
    edited: "Last edited",
  };

  const total = $derived(Object.values(scopeCounts).reduce((sum, n) => sum + n, 0));

  let sortOpen = $state(false);

  const chipBase = "tap shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors";
  const chipIdle = "border-surface-700 bg-surface-950 text-surface-300 hover:bg-surface-800";
  const chipActive = "border-primary-800 bg-primary-950 text-primary-300";
</script>

<svelte:window
  onclick={() => (sortOpen = false)}
  onkeydown={(event) => {
    if (event.key === "Escape") sortOpen = false;
  }}
/>

<div class="flex flex-col gap-3">
  <div class="flex items-center gap-2">
    <div class="relative min-w-0 flex-1">
      <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" aria-hidden="true" />
      <input
        type="search"
        value={filter.query}
        oninput={(event) => onchange({ query: event.currentTarget.value })}
        placeholder="Search notes…"
        aria-label="Search notes"
        class="input-base w-full pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {#if filter.query}
        <button
          type="button"
          onclick={() => onchange({ query: "" })}
          aria-label="Clear search"
          class="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded border-none bg-transparent text-surface-400 hover:text-surface-100 cursor-pointer"
        ><X class="h-4 w-4" aria-hidden="true" /></button>
      {/if}
    </div>

    <button
      type="button"
      onclick={onNew}
      class="tap inline-flex shrink-0 items-center gap-1.5 rounded border border-primary-700 bg-primary-900 px-3 py-1.5 text-sm text-primary-200 hover:bg-primary-800 cursor-pointer transition-colors"
    >
      <Plus class="h-4 w-4" aria-hidden="true" />
      <span class="max-sm:sr-only">New note</span>
    </button>
  </div>

  <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
    <div
      role="group"
      aria-label="Filter by scope"
      class="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-1 lg:px-0"
    >
      <button
        type="button"
        onclick={() => onchange({ scope: "" })}
        aria-pressed={filter.scope === ""}
        class="{chipBase} {filter.scope === '' ? chipActive : chipIdle}"
      >All <span class="tabular-nums opacity-70">{total}</span></button>
      {#each NOTE_SCOPES as scope (scope)}
        <button
          type="button"
          onclick={() => onchange({ scope: filter.scope === scope ? "" : scope })}
          aria-pressed={filter.scope === scope}
          class="{chipBase} {filter.scope === scope ? chipActive : chipIdle}"
        >{label(scope)} <span class="tabular-nums opacity-70">{scopeCounts[scope] ?? 0}</span></button>
      {/each}
    </div>

    <div class="flex items-center justify-between gap-2 lg:justify-end">
      <div class="flex items-center gap-2">
        <div class="relative">
          <button
            type="button"
            onclick={(event) => {
              event.stopPropagation();
              sortOpen = !sortOpen;
            }}
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            aria-label="Sort order: {SORT_LABEL[filter.sort]}"
            class="tap inline-flex items-center gap-1.5 rounded border border-surface-700 bg-surface-900 px-3 py-1.5 text-xs text-surface-300 hover:bg-surface-800 cursor-pointer transition-colors"
          >
            <ArrowUpDown class="h-3.5 w-3.5" aria-hidden="true" />
            {SORT_LABEL[filter.sort]}
          </button>
          {#if sortOpen}
            <div role="menu" aria-label="Sort order" class="absolute left-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-surface-600 bg-surface-900 p-1 shadow-2xl">
              {#each Object.entries(SORT_LABEL) as [value, text] (value)}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter.sort === value}
                  onclick={() => {
                    onchange({ sort: value as NotesFilter["sort"] });
                    sortOpen = false;
                  }}
                  class="tap block w-full rounded border-none bg-transparent px-3 py-1.5 text-left text-xs cursor-pointer hover:bg-surface-800 {filter.sort === value
                    ? 'text-primary-300'
                    : 'text-surface-200'}"
                >{text}</button>
              {/each}
            </div>
          {/if}
        </div>

        <button
          type="button"
          onclick={onToggleSelecting}
          aria-pressed={selecting}
          class="tap inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs cursor-pointer transition-colors {selecting
            ? 'border-primary-800 bg-primary-950 text-primary-300'
            : 'border-surface-700 bg-surface-900 text-surface-300 hover:bg-surface-800'}"
        >
          <ListChecks class="h-3.5 w-3.5" aria-hidden="true" />
          Select
        </button>
      </div>

      <div role="group" aria-label="View" class="flex overflow-hidden rounded border border-surface-700">
        <button
          type="button"
          onclick={() => onchange({ view: "active" })}
          aria-pressed={filter.view !== "deleted"}
          class="tap px-3 py-1.5 text-xs cursor-pointer transition-colors {filter.view !== 'deleted'
            ? 'bg-surface-800 text-surface-100'
            : 'bg-surface-900 text-surface-400 hover:bg-surface-800'}"
        >Notes</button>
        <button
          type="button"
          onclick={() => onchange({ view: "deleted" })}
          aria-pressed={filter.view === "deleted"}
          class="tap px-3 py-1.5 text-xs cursor-pointer border-l border-surface-700 transition-colors {filter.view === 'deleted'
            ? 'bg-surface-800 text-surface-100'
            : 'bg-surface-900 text-surface-400 hover:bg-surface-800'}"
        >Trash{#if trashCount > 0}<span class="ml-1.5 tabular-nums opacity-70">{trashCount}</span>{/if}</button>
      </div>
    </div>
  </div>

  <p class="-mt-1 text-xs text-surface-400">
    {filter.scope
      ? (SCOPE_INFO[filter.scope]?.hint ?? "")
      : "Standing instructions for the briefing. Pick a scope to see what it steers."}
  </p>
</div>
