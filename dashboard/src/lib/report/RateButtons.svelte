<script lang="ts">
  /**
   * The +/- pair (C4, X4).
   *
   * `feedback_events` is the relevance calibration loop, and it only filled up if the reader
   * took a two-click detour to the detail page - so it was starved. These sit on the report
   * entry itself: visible on hover on desktop, always visible and 44px on a phone, which is the
   * viewport that actually matters for this.
   *
   * The rating is optimistic and re-synced from the server on the next load, so a tap under a
   * thumb never waits on a round trip.
   *
   * Online, with JS: `use:enhance` cancels the form's own network submission and hands the tap to
   * the offline outbox instead (OFFLINE_PLAN.md O3), which applies it to the mirror and queues the
   * real write - the same code path whether the VPN is up or not. No JS: the form still posts to
   * `action` directly, which is why it and its hidden fields stay in the markup rather than being
   * replaced by a plain button.
   */
  import { enhance } from "$app/forms";
  import * as outbox from "#lib/offline/outbox.js";

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
    { signal: "1", glyph: "+", event: "explicit_plus", name: "Relevant - this was worth reading", on: "bg-success-700 border-success-500 text-success-50" },
    { signal: "-1", glyph: "−", event: "explicit_minus", name: "Not relevant", on: "bg-error-700 border-error-500 text-error-50" },
  ] as const;
</script>

<div class="flex items-center gap-1">
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
        class="h-11 w-11 sm:h-8 sm:w-8 rounded text-base font-bold transition-colors border cursor-pointer
          {rating === button.event ? button.on : 'bg-surface-800 border-surface-500 text-surface-300 hover:border-surface-400'}"
      >
        <span aria-hidden="true">{button.glyph}</span>
        <span class="sr-only">{button.name}</span>
      </button>
    </form>
  {/each}
</div>
