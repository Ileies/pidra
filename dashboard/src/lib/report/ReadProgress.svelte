<script lang="ts">
  /**
   * Reading progress on `/[date]`: a thin bar above the header (slides in on first scroll) plus a "N min left" chip, which small screens replace with only the one-time reward at the bottom center. Purely
   * client-side; the persisted read state comes in as `read` (written by `useReadReceipt`). The end
   * only counts after a real scroll (`scrolled`), so a short report does not celebrate on load, and
   * never for a report that is already read. The "Read" chip exists only during the one celebration;
   * afterwards the bar and chip track the scroll position like for any unread report. The celebration never
   * blocks (pointer-events off, ends by itself); reduced motion is handled by the global rule in app.css.
   */
  import { untrack } from "svelte";
  import Check from "@lucide/svelte/icons/check";

  interface Props {
    /** The element holding the report text. */
    target: HTMLElement | undefined;
    /** Changes with the report, which resets the celebration. */
    date: string;
    /** The mirror's read state for this report (synced across devices). The celebration plays only
     *  on the transition to read, never for a report that already is. */
    read: boolean;
  }

  let { target, date, read }: Props = $props();

  const WORDS_PER_MINUTE = 230;
  const SPARKS = 14;

  let progress = $state(0);
  let words = $state(0);
  let burst = $state(false);
  /** True once the reader has scrolled; the bar slides in then and the chip may show. */
  let started = $state(false);
  let isSmall = $state(false);
  let scrolled = false;
  /** True once the celebration has played (or the report was already read on arrival). */
  let celebrated = false;

  const minutesLeft = $derived(Math.ceil((words * (1 - progress)) / WORDS_PER_MINUTE));
  const label = $derived(
    burst ? "Read" : minutesLeft <= 0 ? "Almost done" : minutesLeft === 1 ? "1 min left" : `${minutesLeft} min left`
  );

  function countWords(el: HTMLElement): number {
    return (el.innerText.match(/\S+/g) ?? []).length;
  }

  $effect(() => {
    void date;
    progress = 0;
    celebrated = untrack(() => read);
    burst = false;
    scrolled = false;
    started = false;
    if (!target) return;
    const small = window.matchMedia("(max-width: 639.98px)");
    const syncSmall = () => (isSmall = small.matches);
    syncSmall();
    small.addEventListener("change", syncSmall);
    const el = target;

    const measure = () => {
      words = countWords(el);
      update();
    };
    const update = () => {
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      progress = span <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / span));
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (!celebrated && scrolled && atEnd) {
        celebrated = true;
        burst = true;
        setTimeout(() => (burst = false), 2200);
      }
    };
    const onScroll = () => {
      scrolled = true;
      started = window.scrollY > 8;
      update();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      small.removeEventListener("change", syncSmall);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
  });
</script>

{#if words > 0}
  <!-- Fixed above the (transparent) navbar, so it overlays instead of pushing the header down. It
       slides in once the reader has scrolled. -->
  <div
    class="bar pointer-events-none fixed inset-x-0 top-0 z-40 {started ? 'bar-in' : ''}"
    role="progressbar"
    aria-label="Reading progress"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
  >
    <div class="h-[3px] bg-surface-800">
      <div
        class="h-full origin-left transition-colors duration-500 {burst ? 'bg-success-400' : 'bg-primary-400'} {burst ? 'shimmer' : ''}"
        style="width: {progress * 100}%"
      ></div>
    </div>
  </div>

  <!-- Desktop: a chip under the header. Small screens: nothing, except the one-time reward at the
       bottom center (above the tab bar). -->
  {#if started && (!isSmall || burst)}
    <div
      class="pointer-events-none fixed z-30 flex justify-end max-sm:inset-x-0 max-sm:justify-center sm:inset-x-0 sm:px-4 sm:pt-1.5
        max-sm:bottom-[calc(3.5rem+var(--safe-b,0px)+0.75rem)] sm:top-[var(--header-h,0px)]"
    >
      <span
        class="chip relative flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums
          {burst
          ? 'pop border-success-700 bg-success-950 text-success-300'
          : 'border-surface-700 bg-surface-900/90 text-surface-300'}"
      >
        {#if burst}<Check class="h-3 w-3" aria-hidden="true" />{/if}
        {label}
        {#if burst}
          {#each Array(SPARKS) as _, i (i)}
            <i
              class="spark"
              style="--a: {(i / SPARKS) * 360 + (i % 2) * 12}deg; --d: {34 + (i % 3) * 12}px; --h: {i % 2 ? 'var(--color-success-400)' : 'var(--color-primary-400)'}"
            ></i>
          {/each}
        {/if}
      </span>
    </div>
  {/if}
{/if}

<style>
  .bar {
    opacity: 0;
    transform: translateY(-100%);
    transition:
      transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.18s ease-out;
  }
  .bar-in {
    opacity: 1;
    transform: translateY(0);
  }
  .pop {
    animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .shimmer {
    background-image: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.55), transparent);
    background-size: 40% 100%;
    background-repeat: no-repeat;
    animation: sweep 1.2s ease-out 1;
  }
  .spark {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 5px;
    height: 5px;
    margin: -2.5px;
    border-radius: 9999px;
    background: var(--h);
    animation: fly 1.4s ease-out forwards;
  }
  @keyframes pop {
    0% { transform: scale(0.8); }
    100% { transform: scale(1); }
  }
  @keyframes sweep {
    from { background-position: -50% 0; }
    to { background-position: 150% 0; }
  }
  @keyframes fly {
    0% { transform: rotate(var(--a)) translateX(0) scale(1); opacity: 1; }
    100% { transform: rotate(var(--a)) translateX(var(--d)) scale(0.2); opacity: 0; }
  }
</style>
