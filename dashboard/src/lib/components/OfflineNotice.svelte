<script lang="ts">
  import WifiOff from "@lucide/svelte/icons/wifi-off";
  /**
   * A page that needs the connection, offline: live operational state -
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
  <WifiOff class="h-10 w-10 text-surface-500" strokeWidth={1.5} />
  <h1 class="text-lg font-semibold text-surface-100">{label} needs the connection</h1>
  <p class="text-sm text-surface-400 max-w-prose">{reason}</p>
  <p class="text-xs text-surface-500">It opens by itself once the connection is back.</p>
  {#if onRetry}
    <button
      type="button"
      onclick={onRetry}
      disabled={busy}
      class="btn btn-md btn-solid mt-2"
    >
      {busy ? "Checking…" : "Try again"}
    </button>
  {/if}
</div>
