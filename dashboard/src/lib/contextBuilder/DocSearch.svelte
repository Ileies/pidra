<script lang="ts">
  /**
   * Search reaches into both tabs at once: the highlighted HTML for a tab still renders fine while
   * that tab is hidden, so a match in the tab you are not looking at is found immediately instead
   * of only after you happen to switch there. This owns the box and the match cursor; the page owns
   * the query (to highlight with) and the content root (to look for matches in).
   */
  import Search from "@lucide/svelte/icons/search";
  import { tick } from "svelte";
  import { openAncestors } from "#lib/ui/details.js";

  interface Props {
    /** The debounced query the page highlights with. */
    query: string;
    root: HTMLElement | undefined;
    /** Anything that changes when the highlighted content does, so the matches are found again. */
    content: unknown[];
    onreveal: (el: HTMLElement) => void;
  }

  let { query = $bindable(), root, content, onreveal }: Props = $props();

  let input = $state("");
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let matches: HTMLElement[] = [];
  let index = $state(0);
  let count = $state(0);

  function onInput(value: string) {
    input = value;
    clearTimeout(debounce);
    debounce = setTimeout(() => (query = value), 150);
  }

  function clear() {
    clearTimeout(debounce);
    input = "";
    query = "";
  }

  function reveal(el: HTMLElement) {
    openAncestors(el);
    onreveal(el);
    void tick().then(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  // Re-finds every match whenever the query (or the content it searches) changes. Cheaper than
  // diffing the previous highlight pass away: the highlighted HTML is already a fresh string each
  // time, so there is nothing stale to undo.
  $effect(() => {
    const q = query;
    void content;
    if (!root) return;
    const scope = root;
    void tick().then(() => {
      const found = Array.from(scope.querySelectorAll<HTMLElement>("mark.search-hit"));
      matches = found;
      count = found.length;
      index = 0;
      found.forEach((m, i) => m.classList.toggle("search-hit-current", i === 0));
      if (q && found.length > 0) reveal(found[0]);
    });
  });

  function go(delta: number) {
    if (matches.length === 0) return;
    matches[index]?.classList.remove("search-hit-current");
    index = (index + delta + matches.length) % matches.length;
    matches[index]?.classList.add("search-hit-current");
    reveal(matches[index]);
  }
</script>

<div class="bg-surface-900 border border-surface-700 rounded-lg p-2 flex items-center gap-2">
  <Search class="size-4 text-surface-500 shrink-0" />
  <input
    type="search"
    placeholder="Search the document and source summaries…"
    value={input}
    oninput={(e) => onInput(e.currentTarget.value)}
    class="flex-1 bg-transparent text-surface-100 text-sm placeholder:text-surface-500 outline-none min-w-0"
  />
  {#if query}
    <span class="text-surface-400 text-xs tabular-nums shrink-0" aria-live="polite">
      {count > 0 ? `${index + 1} / ${count}` : "No matches"}
    </span>
    <button type="button" class="tap nav-btn nav-btn-muted shrink-0" disabled={count === 0} onclick={() => go(-1)} aria-label="Previous match">↑</button>
    <button type="button" class="tap nav-btn nav-btn-muted shrink-0" disabled={count === 0} onclick={() => go(1)} aria-label="Next match">↓</button>
    <button type="button" class="tap nav-btn nav-btn-muted shrink-0" onclick={clear} aria-label="Clear search">✕</button>
  {/if}
</div>
