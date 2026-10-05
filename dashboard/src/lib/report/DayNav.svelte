<script lang="ts">
  /**
   * Day stepping (prev/next props come from `/[date]/+page.ts`; Left/Right arrow keys step too) and
   * the archive picker behind the date. The archive list is read from the mirror on every open, so
   * it is exactly the reports this device can open, online or not, with no request.
   */
  import { goto } from "$app/navigation";
  import { isTyping } from "#lib/ui/keys.js";
  import { dismissable } from "#lib/ui/dismissable.js";
  import { archive, type ArchiveDay } from "#lib/offline/repo.js";
  import { fmtDate } from "#lib/format.js";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronsRight from "@lucide/svelte/icons/chevrons-right";

  interface Props {
    date: string;
    today: string;
    prevDate: string | null;
    nextDate: string | null;
    latestDate: string | null;
  }

  let { date, today, prevDate, nextDate, latestDate }: Props = $props();

  /** The jump to the newest report (`/`) shows only when the plain next-day arrow is not enough: 2+ days behind. */
  const showLatest = $derived(
    latestDate !== null && (Date.parse(latestDate) - Date.parse(date)) / 86_400_000 >= 2,
  );

  let open = $state(false);
  let days = $state<ArchiveDay[] | null>(null);

  async function openPicker() {
    open = !open;
    // Read on every open: a sync since the last one may have brought a day.
    if (open) days = await archive(null);
  }

  /** Left/Right arrows step days, unless typing or a modifier is held. */
  function onKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;

    if (event.key === "ArrowLeft" && prevDate) goto(`/${prevDate}`);
    else if (event.key === "ArrowRight" && nextDate) goto(`/${nextDate}`);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<nav class="flex items-center justify-between gap-3" aria-label="Day">
  {#if prevDate}
    <a
      href="/{prevDate}"
      class="btn btn-step btn-surface"
    >
      <ChevronLeft class="h-5 w-5 shrink-0" aria-hidden="true" />
      <span class="hidden xs:inline tabular-nums">{prevDate}</span>
      <span class="sr-only">Previous day, {prevDate}</span>
    </a>
  {:else}
    <span class="btn btn-step border-surface-800 text-surface-400 opacity-40 select-none" aria-hidden="true">
      <ChevronLeft class="h-5 w-5" />
    </span>
  {/if}

  <div class="relative min-w-0 text-center" use:dismissable={{ open, onclose: () => (open = false) }}>
    <button
      type="button"
      aria-expanded={open}
      onclick={openPicker}
      class="tap rounded-lg px-3 py-1 hover:bg-surface-900 bg-transparent border-none"
    >
      <span class="block text-base font-semibold text-surface-50 tabular-nums">{fmtDate(date)}</span>
      <span class="block text-xs {date === today ? 'text-primary-400' : 'text-surface-400'}">
        {date === today ? "Today" : "Open the archive"}
      </span>
    </button>

    {#if open}
      <div
        class="absolute left-1/2 z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-surface-700 bg-surface-900 shadow-2xl text-left"
      >
        <div class="flex items-center justify-between gap-2 border-b border-surface-800 px-3 py-2">
          <span class="text-xs font-semibold text-surface-200">Recent reports</span>
          {#if date !== today}
            <a href="/" class="text-xs text-primary-400 no-underline">Today</a>
          {/if}
        </div>

        <ul class="max-h-[50dvh] overflow-y-auto py-1">
          {#if days && days.length === 0}
            <li class="px-3 py-3 text-xs text-surface-400">No reports yet.</li>
          {:else}
            {#each days ?? [] as day (day.date)}
              <li>
                <a
                  href="/{day.date}"
                  aria-current={day.date === date ? "page" : undefined}
                  class="tap flex flex-col gap-0.5 px-3 py-2 no-underline transition-colors
                    {day.date === date ? 'bg-surface-800' : 'hover:bg-surface-800'}"
                >
                  <span class="flex items-baseline justify-between gap-2">
                    <span class="text-xs font-medium text-surface-100 tabular-nums">{fmtDate(day.date)}</span>
                    {#if day.itemsIncluded != null}
                      <span class="text-xs text-surface-400 tabular-nums">{day.itemsIncluded} items</span>
                    {/if}
                  </span>
                  {#if day.summary}
                    <span class="line-clamp-2 text-xs text-surface-400">{day.summary}</span>
                  {/if}
                </a>
              </li>
            {/each}
          {/if}
        </ul>

        <p class="border-t border-surface-800 px-3 py-2 text-xs text-surface-400">
          <kbd class="font-mono">←</kbd> / <kbd class="font-mono">→</kbd> step days.
        </p>
      </div>
    {/if}
  </div>

  <div class="flex items-center gap-2">
    {#if nextDate}
      <a
        href="/{nextDate}"
        class="btn btn-step btn-surface"
      >
        <span class="hidden xs:inline tabular-nums">{nextDate}</span>
        <ChevronRight class="h-5 w-5 shrink-0" aria-hidden="true" />
        <span class="sr-only">Next day, {nextDate}</span>
      </a>
    {:else}
      <span class="btn btn-step border-surface-800 text-surface-400 opacity-40 select-none" aria-hidden="true">
        <ChevronRight class="h-5 w-5" />
      </span>
    {/if}

    {#if showLatest}
      <a
        href="/"
        class="btn btn-step btn-surface"
      >
        <span class="hidden xs:inline">Latest</span>
        <ChevronsRight class="h-5 w-5 shrink-0" aria-hidden="true" />
        <span class="sr-only">Latest report</span>
      </a>
    {/if}
  </div>
</nav>
