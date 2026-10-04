<script lang="ts">
  /**
   * The audio player for a report. Docked to the bottom of the screen so it stays in reach while
   * the page scrolls, above the tab bar on a phone.
   *
   * The seek bar is cut into one segment per chapter, each as wide as the chapter is long, so the
   * shape of the briefing is visible: how much is personal, how much news, how much depth. A tap
   * in a segment seeks inside that chapter; a tap on a chapter in the list starts it.
   */
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ListMusic from "@lucide/svelte/icons/list-music";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import X from "@lucide/svelte/icons/x";
  import Spinner from "#lib/components/Spinner.svelte";
  import { reportPlayer as player } from "#lib/report/player.svelte.js";

  let listOpen = $state(false);

  function clock(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  function fill(index: number): number {
    if (index < player.current) return 100;
    if (index > player.current) return 0;
    const length = (player.chapter?.durationMs ?? 0) / 1000;
    return length > 0 ? Math.min(100, (player.position / length) * 100) : 0;
  }

  function seek(event: MouseEvent, index: number) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Keyboard activation reports no pointer position: that starts the chapter.
    const fraction = event.detail === 0 ? 0 : Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    void player.go(index, { fraction });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && listOpen) listOpen = false;
  }

  const sections = $derived.by(() => {
    const out: { name: string; chapters: { index: number; title: string; durationMs: number }[] }[] = [];
    player.chapters.forEach((chapter, index) => {
      const last = out[out.length - 1];
      const item = { index, title: chapter.title, durationMs: chapter.durationMs };
      if (last?.name === chapter.section) last.chapters.push(item);
      else out.push({ name: chapter.section, chapters: [item] });
    });
    return out;
  });

  const button =
    "tap inline-flex items-center justify-center gap-1 rounded-full text-surface-200 bg-transparent border-none hover:bg-surface-800 disabled:opacity-40 disabled:cursor-not-allowed";
</script>

<svelte:window onkeydown={onKeydown} />

{#if player.open}
  <section
    aria-label="Report audio player"
    class="fixed inset-x-2 z-40 mx-auto flex max-w-2xl flex-col gap-2 rounded-xl border border-surface-700 bg-surface-900 p-3 shadow-2xl
      bottom-[calc(3.5rem+var(--safe-b)+0.5rem)] lg:bottom-4"
  >
    {#if listOpen && sections.length > 0}
      <div class="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-lg border border-surface-800 bg-surface-950 py-1">
        {#each sections as section (section.name + section.chapters[0].index)}
          <p class="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-surface-400">{section.name}</p>
          {#each section.chapters as chapter (chapter.index)}
            <button
              type="button"
              aria-current={chapter.index === player.current ? "true" : undefined}
              onclick={() => {
                void player.go(chapter.index);
                listOpen = false;
              }}
              class="tap flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm border-none
                {chapter.index === player.current ? 'bg-surface-800 text-primary-300' : 'bg-transparent text-surface-200 hover:bg-surface-800'}"
            >
              <span class="min-w-0 truncate">{chapter.title}</span>
              <span class="shrink-0 text-xs tabular-nums text-surface-400">{clock(chapter.durationMs)}</span>
            </button>
          {/each}
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-surface-400">{player.chapter?.section ?? "Report audio"}</p>
        <p class="truncate text-sm font-semibold text-surface-50">{player.chapter?.title ?? "Loading the briefing"}</p>
      </div>
      <button
        type="button"
        class="{button} h-10 w-10"
        aria-label={listOpen ? "Hide the chapters" : "Show the chapters"}
        aria-expanded={listOpen}
        disabled={player.chapters.length === 0}
        onclick={() => (listOpen = !listOpen)}
      >
        {#if listOpen}<ChevronUp class="h-5 w-5" aria-hidden="true" />{:else}<ListMusic class="h-5 w-5" aria-hidden="true" />{/if}
      </button>
      <button type="button" class="{button} h-10 w-10" aria-label="Close the player" onclick={() => player.close()}>
        <X class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>

    {#if player.chapters.length > 0}
      <div class="flex items-center" role="group" aria-label="Chapters">
        {#each player.chapters as chapter, index (chapter.key)}
          <button
            type="button"
            style="flex: {Math.max(chapter.durationMs, 1000)} 1 0"
            class="group relative h-6 min-w-1.5 border-none bg-transparent p-0
              {index > 0 && chapter.section !== player.chapters[index - 1].section ? 'ml-2' : index > 0 ? 'ml-0.5' : ''}"
            aria-label="{chapter.section}: {chapter.title}, chapter {index + 1} of {player.chapters.length}"
            aria-current={index === player.current ? "true" : undefined}
            title={chapter.title}
            onclick={(event) => seek(event, index)}
          >
            <span class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-700 transition-[height] group-hover:h-2.5">
              <span class="block h-full bg-primary-400" style="width: {fill(index)}%"></span>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="flex items-center justify-between text-xs tabular-nums text-surface-400">
      <span>{clock(player.elapsedMs)}</span>
      <span>{clock(player.totalMs)}</span>
    </div>

    {#if player.error}
      <p role="alert" class="rounded-lg border border-error-700 bg-error-950 px-3 py-2 text-xs text-error-200">
        {player.error}
        <button type="button" class="ml-2 border-none bg-transparent p-0 text-error-100 underline" onclick={() => player.toggle()}>Try again</button>
      </p>
    {/if}

    <div class="flex items-center justify-between gap-1">
      <button
        type="button"
        class="{button} h-10 min-w-12 px-2 text-xs font-semibold tabular-nums"
        aria-label="Playback speed {player.speed}x. Change"
        onclick={() => player.cycleSpeed()}
      >
        {player.speed}x
      </button>

      <div class="flex items-center gap-1">
        <button type="button" class="{button} h-11 w-11" aria-label="Previous chapter" disabled={player.chapters.length === 0} onclick={() => player.previous()}>
          <SkipBack class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="{button} h-11 w-11 text-xs font-semibold" aria-label="Back 15 seconds" disabled={player.chapters.length === 0} onclick={() => player.back()}>
          <RotateCcw class="h-4 w-4" aria-hidden="true" />15
        </button>
        <button
          type="button"
          class="tap inline-flex h-12 w-12 items-center justify-center rounded-full border-none bg-primary-500 text-surface-950 hover:bg-primary-400 disabled:opacity-60"
          aria-label={player.buffering ? "Preparing the audio" : player.playing ? "Pause" : "Play"}
          disabled={player.chapters.length === 0}
          onclick={() => player.toggle()}
        >
          {#if player.buffering}
            <Spinner size="md" label="Preparing the audio" />
          {:else if player.playing}
            <Pause class="h-6 w-6" aria-hidden="true" fill="currentColor" />
          {:else}
            <Play class="h-6 w-6" aria-hidden="true" fill="currentColor" />
          {/if}
        </button>
        <button type="button" class="{button} h-11 w-11 text-xs font-semibold" aria-label="Forward 30 seconds" disabled={player.chapters.length === 0} onclick={() => player.forward()}>
          30<RotateCw class="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" class="{button} h-11 w-11" aria-label="Next chapter" disabled={player.chapters.length === 0} onclick={() => player.next()}>
          <SkipForward class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <span class="min-w-12" aria-hidden="true"></span>
    </div>
  </section>
{/if}
