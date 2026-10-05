<script lang="ts">
  /**
   * The seek bar of the report player, cut into one segment per chapter, each as wide as the
   * chapter is long, so the shape of the briefing is visible: how much is personal, how much news,
   * how much depth.
   *
   * It behaves like YouTube's chapter bar: a tap near the edge of a segment snaps to the boundary
   * between two chapters, so jumping by section is quick, while holding (or dragging) scrubs freely
   * and seeks exactly where the pointer is released.
   */
  import { reportPlayer as player } from "#lib/report/player.svelte.js";

  /** A tap this close (px) to the edge of a chapter lands on the boundary instead of the exact spot. */
  const SNAP_PX = 14;
  const HOLD_MS = 350;
  const DRAG_PX = 8;

  /** Where a hold or drag is pointing while the bar is being scrubbed, null otherwise. */
  let scrub = $state<{ index: number; fraction: number } | null>(null);
  let bar = $state<HTMLElement>();
  let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;

  function clock(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  function fill(index: number): number {
    const at = scrub ?? { index: player.current, fraction: null };
    if (index < at.index) return 100;
    if (index > at.index) return 0;
    if (at.fraction != null) return at.fraction * 100;
    const length = (player.chapter?.durationMs ?? 0) / 1000;
    return length > 0 ? Math.min(100, (player.position / length) * 100) : 0;
  }

  /** The chapter segment nearest a screen x, with the pixel offset into it. */
  function locate(clientX: number): { index: number; fraction: number; offset: number; width: number } | null {
    const segments = bar?.querySelectorAll<HTMLElement>("[data-chapter]");
    if (!segments || segments.length === 0) return null;
    let best = 0;
    let bestGap = Infinity;
    segments.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      // Inside a segment the gap is 0; the margins between segments go to the nearer one.
      const gap = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    const r = segments[best].getBoundingClientRect();
    const offset = Math.min(r.width, Math.max(0, clientX - r.left));
    return { index: best, fraction: r.width > 0 ? offset / r.width : 0, offset, width: r.width };
  }

  /** A quick tap: near a chapter edge it lands between the chapters, elsewhere exactly where it was. */
  function tap(clientX: number) {
    const hit = locate(clientX);
    if (!hit) return;
    const snap = Math.min(SNAP_PX, hit.width / 3);
    if (hit.offset <= snap) void player.go(hit.index);
    else if (hit.width - hit.offset <= snap && hit.index + 1 < player.chapters.length) void player.go(hit.index + 1);
    else void player.go(hit.index, { fraction: hit.fraction });
  }

  function stopPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function onDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const x = event.clientX;
    press = {
      x,
      y: event.clientY,
      timer: setTimeout(() => {
        const hit = locate(x);
        if (hit) scrub = { index: hit.index, fraction: hit.fraction };
      }, HOLD_MS),
    };
  }

  function onMove(event: PointerEvent) {
    if (!press && !scrub) return;
    if (!scrub && press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
    const hit = locate(event.clientX);
    if (hit) scrub = { index: hit.index, fraction: hit.fraction };
  }

  function onUp(event: PointerEvent) {
    if (!press) return;
    const scrubbed = scrub;
    stopPress();
    scrub = null;
    if (scrubbed) void player.go(scrubbed.index, { fraction: scrubbed.fraction });
    else tap(event.clientX);
  }

  function onCancel() {
    stopPress();
    scrub = null;
  }

  /** Keyboard activation reports no pointer position and starts the chapter. */
  function startChapter(event: MouseEvent, index: number) {
    if (event.detail === 0) void player.go(index);
  }

  const elapsedMs = $derived.by(() => {
    if (!scrub) return player.elapsedMs;
    let ms = 0;
    for (let i = 0; i < scrub.index; i++) ms += player.chapters[i].durationMs;
    return ms + scrub.fraction * player.chapters[scrub.index].durationMs;
  });
</script>

{#if player.chapters.length > 0}
  <div
    bind:this={bar}
    class="flex touch-none select-none items-center"
    role="group"
    aria-label="Chapters"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onCancel}
  >
    {#each player.chapters as chapter, index (chapter.key)}
      <button
        type="button"
        data-chapter
        style="flex: {Math.max(chapter.durationMs, 1000)} 1 0"
        class="group relative h-6 min-w-1.5 border-none bg-transparent p-0
          {index > 0 && chapter.section !== player.chapters[index - 1].section ? 'ml-2' : index > 0 ? 'ml-0.5' : ''}"
        aria-label="{chapter.section}: {chapter.title}, chapter {index + 1} of {player.chapters.length}"
        aria-current={index === player.current ? "true" : undefined}
        title={chapter.title}
        onclick={(event) => startChapter(event, index)}
      >
        <span class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-700 transition-[height] group-hover:h-2.5">
          <span class="block h-full bg-primary-400" style="width: {fill(index)}%"></span>
        </span>
      </button>
    {/each}
  </div>
{/if}

<div class="flex items-center justify-between text-xs tabular-nums text-surface-400">
  <span>{clock(elapsedMs)}</span>
  <span>{clock(player.totalMs)}</span>
</div>
