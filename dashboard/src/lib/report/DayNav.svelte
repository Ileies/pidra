<script lang="ts">
  /**
   * Day stepping and the archive (C8, M-1).
   *
   * The steppers used to live in the navbar, where they were two of the twelve controls that
   * made the mobile header six rows tall, and they were only ever on this one route. They are
   * here now, as two large targets beside the date, with the archive behind the date itself.
   *
   * The archive list is read when the picker opens, from the mirror: it is
   * the list of reports this device can actually open, online or not, and it costs no request.
   */
  import { goto } from "$app/navigation";
  import { archive, type ArchiveDay } from "#lib/offline/repo.js";
  import { fmtDate } from "#lib/format.js";

  interface Props {
    date: string;
    today: string;
    prevDate: string | null;
    nextDate: string | null;
  }

  let { date, today, prevDate, nextDate }: Props = $props();

  let open = $state(false);
  let days = $state<ArchiveDay[] | null>(null);

  async function openPicker() {
    open = !open;
    // Read on every open: a sync since the last one may have brought a day.
    if (open) days = await archive(null);
  }

  /** j and k step days, which is the one keyboard shortcut this page really wants (E1). */
  function onKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;

    if (event.key === "j" && prevDate) goto(`/${prevDate}`);
    else if (event.key === "k" && nextDate) goto(`/${nextDate}`);
    else if (event.key === "Escape" && open) open = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<nav class="flex items-center justify-between gap-3" aria-label="Day">
  {#if prevDate}
    <a
      href="/{prevDate}"
      class="tap flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-700 bg-surface-900 text-sm text-surface-200 no-underline hover:bg-surface-800"
    >
      <span aria-hidden="true">←</span>
      <span class="hidden xs:inline tabular-nums">{prevDate}</span>
      <span class="sr-only">Previous day, {prevDate}</span>
    </a>
  {:else}
    <span class="tap flex items-center px-3 py-2 rounded-lg border border-surface-800 text-sm text-surface-400 opacity-40 select-none" aria-hidden="true">←</span>
  {/if}

  <div class="relative min-w-0 text-center">
    <button
      type="button"
      aria-expanded={open}
      onclick={openPicker}
      class="tap rounded-lg px-3 py-1 hover:bg-surface-900 cursor-pointer bg-transparent border-none"
    >
      <span class="block text-base font-semibold text-surface-50 tabular-nums">{fmtDate(date)}</span>
      <span class="block text-xs {date === today ? 'text-primary-400' : 'text-surface-400'}">
        {date === today ? "Today" : "Open the archive"}
      </span>
    </button>

    {#if open}
      <button type="button" aria-label="Close the archive" class="fixed inset-0 z-30 cursor-default" onclick={() => (open = false)}></button>
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
          <kbd class="font-mono">j</kbd> / <kbd class="font-mono">k</kbd> step days.
        </p>
      </div>
    {/if}
  </div>

  {#if nextDate}
    <a
      href="/{nextDate}"
      class="tap flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-700 bg-surface-900 text-sm text-surface-200 no-underline hover:bg-surface-800"
    >
      <span class="hidden xs:inline tabular-nums">{nextDate}</span>
      <span aria-hidden="true">→</span>
      <span class="sr-only">Next day, {nextDate}</span>
    </a>
  {:else}
    <span class="tap flex items-center px-3 py-2 rounded-lg border border-surface-800 text-sm text-surface-400 opacity-40 select-none" aria-hidden="true">→</span>
  {/if}
</nav>
