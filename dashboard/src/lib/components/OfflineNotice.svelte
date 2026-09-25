<script lang="ts">
  /**
   * A page that needs the connection, offline (OFFLINE_PLAN.md §1, §14): live operational state -
   * a pending approval queue, a running pipeline, an SSE chat with a model - where a cached copy
   * would be a lie rather than a convenience. Rendered by the root `+error.svelte` in place of the
   * page body when the load failed because pronix was not reachable, which is also what takes the
   * reader back to the page by itself once it is.
   */
  interface Props {
    label: string;
    reason: string;
    onRetry?: () => void;
    busy?: boolean;
  }

  let { label, reason, onRetry, busy = false }: Props = $props();
</script>

<div class="mx-auto max-w-md px-4 py-16 flex flex-col items-center gap-3 text-center">
  <svg viewBox="0 0 24 24" class="h-10 w-10 text-surface-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5.5 13.5a9 9 0 0 1 4-2.3M18.5 13.5a9 9 0 0 0-2.7-1.9M12 20h.01" />
  </svg>
  <h1 class="text-lg font-semibold text-surface-100">{label} needs the connection</h1>
  <p class="text-sm text-surface-400 max-w-prose">{reason}</p>
  <p class="text-xs text-surface-500">It opens by itself once the VPN is back.</p>
  {#if onRetry}
    <button
      type="button"
      onclick={onRetry}
      disabled={busy}
      class="tap mt-2 rounded border border-surface-600 bg-surface-900 px-4 py-2 text-sm text-surface-200 hover:bg-surface-800 disabled:opacity-50 cursor-pointer"
    >
      {busy ? "Checking…" : "Try again"}
    </button>
  {/if}
</div>
