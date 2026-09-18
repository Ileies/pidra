<script lang="ts">
  /**
   * Tier B, offline (OFFLINE_PLAN.md §1, O4): live operational state - a pending approval queue, a
   * running pipeline, an SSE chat with a model - where a cached copy would be a lie rather than a
   * convenience. Rendered by the root `+error.svelte` in place of the page body, so the failure
   * this hides is a real one: the network request one of these pages needs simply had nowhere to
   * go, which SvelteKit's default error page would otherwise show as a raw fetch failure.
   */
  interface Props {
    label: string;
    reason: string;
  }

  let { label, reason }: Props = $props();
</script>

<div class="mx-auto max-w-md px-4 py-16 flex flex-col items-center gap-3 text-center">
  <svg viewBox="0 0 24 24" class="h-10 w-10 text-surface-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5.5 13.5a9 9 0 0 1 4-2.3M18.5 13.5a9 9 0 0 0-2.7-1.9M12 20h.01" />
  </svg>
  <h1 class="text-lg font-semibold text-surface-100">{label} needs the connection</h1>
  <p class="text-sm text-surface-400 max-w-prose">{reason}</p>
  <p class="text-xs text-surface-500">It will work again once the VPN is back.</p>
</div>
