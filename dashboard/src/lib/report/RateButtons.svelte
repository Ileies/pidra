<script lang="ts">
  /**
   * The thumbs up/down pair (feeds `feedback_events`, the relevance calibration loop). 44px targets
   * on a phone. The rating is optimistic (`onRate` updates the page) and re-synced on the next load.
   *
   * With JS, `use:enhance` cancels the form's own submission and hands the tap to the offline
   * outbox (`outbox.rate`), which updates the mirror and queues the write, online or not. Without
   * JS the form posts to `action` (`?/rate`, exposed by `/[date]` and the detail page), which is
   * why it and its hidden fields stay in the markup.
   */
  import { enhance } from "$app/forms";
  import ThumbsDown from "@lucide/svelte/icons/thumbs-down";
  import ThumbsUp from "@lucide/svelte/icons/thumbs-up";
  import * as outbox from "#lib/offline/outbox.js";
  import { offline } from "#lib/offline/state.svelte.js";

  interface Props {
    extractionId: string;
    /** Current rating: "explicit_plus", "explicit_minus" or null. */
    rating: string | null;
    onRate: (extractionId: string, eventType: string | null) => void;
    /** Form action to post to. The report and the detail page both expose `?/rate`. */
    action?: string;
  }

  let { extractionId, rating, onRate, action = "?/rate" }: Props = $props();

  const BUTTONS = [
    { signal: "1", icon: ThumbsUp, event: "explicit_plus", name: "Relevant - this was worth reading", on: "bg-success-700 border-success-500 text-success-50" },
    { signal: "-1", icon: ThumbsDown, event: "explicit_minus", name: "Not relevant", on: "bg-error-700 border-error-500 text-error-50" },
  ] as const;

  /** Optimistic, but never pretending it is durable - a small dot rather than
   *  hiding the fact that this rating has not reached the server yet. */
  const queued = $derived(offline.pending.some((i) => outbox.intentIsFor(i, "rate", extractionId)));
  /** A tap replaces it (`outbox.rate`), so a retry here is just rating again. */
  const failed = $derived(offline.failed.find((i) => outbox.intentIsFor(i, "rate", extractionId)));
</script>

<div class="flex items-center gap-1">
  {#if failed}
    <span class="text-xs text-error-400" title="{failed.lastError ?? 'Refused by the server'}. Tap again to retry.">Not saved</span>
  {:else if queued}
    <span class="h-1.5 w-1.5 rounded-full bg-warning-500" title="Rating queued, not yet synced" aria-hidden="true"></span>
  {/if}
  {#each BUTTONS as button (button.signal)}
    <form
      method="POST"
      {action}
      use:enhance={({ cancel }) => {
        cancel();
        onRate(extractionId, rating === button.event ? null : button.event);
        outbox.rate(extractionId, button.signal);
      }}
    >
      <input type="hidden" name="extraction_id" value={extractionId} />
      <input type="hidden" name="signal" value={button.signal} />
      <button
        type="submit"
        aria-pressed={rating === button.event}
        class="h-11 w-11 sm:h-8 sm:w-8 rounded transition-colors border inline-flex items-center justify-center
          {rating === button.event ? button.on : 'bg-surface-800 border-surface-500 text-surface-300 hover:border-surface-400'}"
      >
        <button.icon class="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
        <span class="sr-only">{button.name}</span>
      </button>
    </form>
  {/each}
</div>
