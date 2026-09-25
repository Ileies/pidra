<script lang="ts">
  // A write the server refused for good (OFFLINE_PLAN.md §6), shown where it was made (H4).
  import { offline } from "./state.svelte.js";
  import { INTENT_LABEL, intentSummary, type Intent } from "./outbox.js";

  interface Props {
    intent: Intent;
    /** Name the target, for a write whose row is not on screen (a create, or a delete). */
    showTarget?: boolean;
  }

  let { intent, showTarget = false }: Props = $props();
</script>

<div role="alert" class="rounded border border-error-800 bg-error-950/40 px-2.5 py-1.5 text-xs text-surface-300 flex flex-col gap-1">
  <p>
    <span class="font-medium text-error-400">Not saved:</span>
    {INTENT_LABEL[intent.kind]}{#if showTarget}<span class="text-surface-200">{" - "}{intentSummary(intent)}</span>{/if}
  </p>
  {#if intent.lastError}<p class="text-error-400/80 break-words">{intent.lastError}</p>{/if}
  <div class="flex gap-2">
    <button
      type="button"
      onclick={() => offline.retryFailed(intent.id)}
      class="tap px-2 py-0.5 rounded bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
    >Retry</button>
    <button
      type="button"
      onclick={() => offline.discardFailed(intent.id)}
      class="tap px-2 py-0.5 rounded bg-surface-800 border border-surface-500 text-surface-100 hover:bg-surface-700 cursor-pointer"
    >Discard</button>
  </div>
</div>
