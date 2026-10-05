<script lang="ts">
  /**
   * Reading progress on `/[date]`: a thin bar under the header plus a "N min left" chip. Purely
   * client-side; the persisted read state comes in as `read` (written by `useReadReceipt`). The end
   * only counts after a real scroll (`scrolled`), so a short report does not celebrate on load, and
   * never for a report that is already read. The celebration never
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
  let done = $state(false);
  let burst = $state(false);
  let scrolled = false;

  const minutesLeft = $derived(Math.ceil((words * (1 - progress)) / WORDS_PER_MINUTE));
  const label = $derived(
    done ? "Read" : minutesLeft <= 0 ? "Almost done" : minutesLeft === 1 ? "1 min left" : `${minutesLeft} min left`
  );

  function countWords(el: HTMLElement): number {
    return (el.innerText.match(/\S+/g) ?? []).length;
  }

  // A sync from another device (or the receipt landing) turns the chip to its quiet "Read" state.
  $effect(() => {
    if (read) done = true;
  });

  $effect(() => {
    void date;
    progress = 0;
    done = untrack(() => read);
    burst = false;
    scrolled = false;
    if (!target) return;
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
      if (done) progress = 1;
      else if (scrolled && atEnd) {
        done = true;
        burst = true;
        progress = 1;
        setTimeout(() => (burst = false), 2200);
      }
    };
    const onScroll = () => {
      scrolled = true;
      update();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
  });
</script>

{#if words > 0}
  <div
    class="pointer-events-none fixed inset-x-0 z-30"
    style="top: var(--header-h, 0px)"
    role="progressbar"
    aria-label="Reading progress"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
  >
    <div class="h-[3px] bg-surface-800/60">
      <div
        class="h-full origin-left transition-colors duration-500 {done ? 'bg-success-400' : 'bg-primary-400'} {burst ? 'shimmer' : ''}"
        style="width: {progress * 100}%"
      ></div>
    </div>
    <div class="relative flex justify-end px-4 pt-1.5">
      <span
        class="chip relative flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs tabular-nums
          {done
          ? `${burst ? 'pop ' : ''}border-success-700 bg-success-950 text-success-300`
          : 'border-surface-700 bg-surface-900/90 text-surface-300'}"
      >
        {#if done}<Check class="h-3 w-3" aria-hidden="true" />{/if}
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
  </div>
{/if}

<style>
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
