<script lang="ts">
  /**
   * Search and route jumping in one surface (D8, E1).
   *
   * Ctrl/Cmd+K opens it, and `/` does too when nothing has focus. The assistant moves to
   * Ctrl/Cmd+J - the collision was called out in the plan and this is where it is settled, with
   * both bindings listed in the `?` overlay so neither is folklore.
   *
   * Routes are matched locally from the registry and always rank above archive hits: jumping to
   * a page you know exists should not wait on a query, and typing "notes" means the page far
   * more often than it means a note containing the word.
   *
   * Offline, the archive half searches this device's copy instead (OFFLINE_PLAN.md §13, H3), and
   * says so: it matches plain text over the mirrored window, which is not what the server's
   * ranked keyword search finds.
   */
  import { goto } from "$app/navigation";
  import { ROUTES } from "#lib/routes.js";
  import type { SearchHit } from "#lib/server/search.js";
  import Spinner from "#lib/components/Spinner.svelte";
  import { net, NetError } from "#lib/offline/net.js";
  import { searchMirror, type OfflineHit } from "#lib/offline/search.js";
  import { offline } from "#lib/offline/state.svelte.js";

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  let { open, onOpenChange }: Props = $props();

  let query = $state("");
  let hits = $state<SearchHit[]>([]);
  let mirrorHits = $state<OfflineHit[]>([]);
  /** Which search answered the current query. */
  let source = $state<"server" | "mirror">("server");
  let loading = $state(false);
  let cursor = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  const routeHits = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ROUTES.slice(0, 6);
    return ROUTES.filter((route) => route.label.toLowerCase().includes(q) || route.href.includes(q));
  });

  interface Result {
    kind: string;
    label: string;
    href: string;
    meta?: string;
    /** Server snippets: `ts_headline` output, sanitised down to `<mark>`. */
    snippet?: string;
    /** Mirror snippets: plain text, marked in the markup below. */
    parts?: OfflineHit["snippet"];
  }

  const results: Result[] = $derived([
    ...routeHits.map((route) => ({ kind: "route", label: route.label, href: route.href, meta: route.href })),
    ...(source === "mirror"
      ? mirrorHits.map((hit) => ({ kind: hit.kind, label: hit.title, href: hit.href, meta: hit.meta, parts: hit.snippet }))
      : hits.map((hit) => ({ kind: hit.kind, label: hit.title, href: hit.href, meta: hit.meta, snippet: hit.snippet }))),
  ]);

  $effect(() => {
    if (open) {
      // Focus lands in the box, and the previous query stays selected so typing replaces it.
      queueMicrotask(() => {
        input?.focus();
        input?.select();
      });
    }
  });

  // Reset the cursor whenever the result set changes underneath it.
  $effect(() => {
    results.length;
    cursor = 0;
  });

  function onInput(event: Event & { currentTarget: HTMLInputElement }) {
    query = event.currentTarget.value;
    clearTimeout(searchTimer);

    const value = query.trim();
    if (value.length < 2) {
      hits = [];
      mirrorHits = [];
      loading = false;
      return;
    }

    loading = true;
    searchTimer = setTimeout(async () => {
      const id = ++requestId;
      try {
        // Known offline, `net()` would refuse in the same frame; skip straight to the mirror.
        if (offline.reachable === "offline") throw new NetError("offline", false);
        const res = await net(`/api/search?q=${encodeURIComponent(value)}`);
        const body = (await res.json()) as { hits: SearchHit[] };
        // A slower earlier request must not overwrite a newer result set.
        if (id === requestId) {
          hits = body.hits;
          source = "server";
        }
      } catch (err) {
        if (err instanceof NetError && err.kind === "offline") {
          const found = await searchMirror(value).catch(() => []);
          if (id === requestId) {
            mirrorHits = found;
            source = "mirror";
          }
        } else if (id === requestId) {
          hits = [];
          source = "server";
        }
      } finally {
        if (id === requestId) loading = false;
      }
    }, 180);
  }

  function choose(index: number) {
    const result = results[index];
    if (!result) return;
    onOpenChange(false);
    goto(result.href);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cursor = Math.min(cursor + 1, results.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cursor = Math.max(cursor - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(cursor);
    }
  }

  const KIND_LABEL: Record<string, string> = {
    route: "Page",
    report: "Report",
    extraction: "Item",
    note: "Note",
    entity: "Entity",
    rule: "Rule",
  };
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10dvh]">
    <button type="button" aria-label="Close search" class="absolute inset-0 bg-surface-950/80 cursor-default" onclick={() => onOpenChange(false)}></button>

    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      class="relative w-full max-w-xl rounded-lg border border-surface-600 bg-surface-900 shadow-2xl overflow-hidden"
    >
      <div class="flex items-center gap-2 border-b border-surface-700 px-3">
        <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-surface-400" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          bind:this={input}
          value={query}
          oninput={onInput}
          onkeydown={onKeydown}
          placeholder="Search reports, items, notes and entities, or jump to a page…"
          aria-label="Search"
          class="flex-1 bg-transparent border-none py-3 text-base sm:text-sm text-surface-100 placeholder-surface-400 outline-none"
        />
        {#if loading}<Spinner label="Searching" />{/if}
      </div>

      {#if source === "mirror" && query.trim().length >= 2}
        <p class="border-b border-surface-800 px-4 py-2 text-xs text-warning-400">
          Offline: searching the copy on this device, exact text only, newest {offline.mirroredReportCount} reports.
        </p>
      {/if}

      <ul class="max-h-[60dvh] overflow-y-auto py-1">
        {#if results.length === 0}
          <li class="px-4 py-6 text-center text-xs text-surface-400">
            {query.trim().length < 2 ? "Type at least two characters." : "Nothing found."}
          </li>
        {:else}
          {#each results as result, index (`${result.kind}-${result.href}-${index}`)}
            <li>
              <button
                type="button"
                onclick={() => choose(index)}
                onmouseenter={() => (cursor = index)}
                aria-current={cursor === index ? "true" : undefined}
                class="tap w-full px-4 py-2 text-left flex flex-col gap-0.5 cursor-pointer border-none transition-colors
                  {cursor === index ? 'bg-surface-800' : 'bg-transparent'}"
              >
                <span class="flex items-baseline gap-2">
                  <span class="text-sm text-surface-100 truncate">{result.label}</span>
                  <span class="ml-auto shrink-0 text-xs text-surface-400">{KIND_LABEL[result.kind] ?? result.kind}</span>
                </span>
                {#if result.parts}
                  <span class="text-xs text-surface-400 line-clamp-2">
                    {result.parts.before}<mark class="bg-primary-900 text-primary-100 rounded-sm px-0.5">{result.parts.match}</mark>{result.parts.after}
                  </span>
                {:else if result.snippet}
                  <!-- ts_headline output, sanitised server-side down to <mark> and nothing else. -->
                  <span class="text-xs text-surface-400 line-clamp-2 [&_mark]:bg-primary-900 [&_mark]:text-primary-100 [&_mark]:rounded-sm [&_mark]:px-0.5">
                    {@html result.snippet}
                  </span>
                {:else if result.meta}
                  <span class="text-xs text-surface-400">{result.meta}</span>
                {/if}
              </button>
            </li>
          {/each}
        {/if}
      </ul>

      <div class="flex flex-wrap items-center gap-3 border-t border-surface-700 px-4 py-2 text-xs text-surface-400">
        <span><kbd class="font-mono">↑</kbd><kbd class="font-mono">↓</kbd> move</span>
        <span><kbd class="font-mono">↵</kbd> open</span>
        <span><kbd class="font-mono">esc</kbd> close</span>
        <span class="ml-auto"><kbd class="font-mono">?</kbd> all shortcuts</span>
      </div>
    </div>
  </div>
{/if}
