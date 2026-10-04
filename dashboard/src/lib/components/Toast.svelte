<script lang="ts">
  /**
   * The toast stack. Mounted once by the root layout, so a toast survives navigation - which is
   * what makes an undo offer trustworthy.
   *
   * Position: above the mobile tab bar and above the safe area, and left-aligned rather than
   * centred, because a centred toast at the bottom of a phone sits exactly where the thumb is
   * (M7). From `sm` up it is a compact bottom-left card instead of full width, clear of the
   * floating assistant on the right; only the bottom offset waits for `lg`, when the tab bar goes.
   */
  import { toasts } from "#lib/toast.svelte.js";

  const TONES = {
    info: "border-surface-500 text-surface-100",
    success: "border-success-700 text-success-200",
    error: "border-error-700 text-error-200",
  } as const;
</script>

{#if toasts.items.length > 0}
  <div
    class="fixed z-50 flex flex-col gap-2 left-4 right-4 sm:right-auto sm:max-w-md
           bottom-[calc(4.5rem+var(--safe-b))] lg:bottom-[calc(1.5rem+var(--safe-b))]"
    role="region"
    aria-label="Notifications"
  >
    {#each toasts.items as toast (toast.id)}
      <div
        role="status"
        aria-live="polite"
        class="relative overflow-hidden rounded-lg bg-surface-800 border text-sm shadow-lg {TONES[toast.tone]}"
      >
        <div class="flex items-center gap-3 px-4 py-2.5">
          <span class="min-w-0 flex-1 break-words">{toast.message}</span>
          {#if toast.undo}
            <button
              onclick={() => toasts.runUndo(toast.id)}
              class="tap shrink-0 px-2.5 py-1 rounded text-xs bg-surface-950 border border-primary-700 text-primary-300 hover:bg-surface-900"
            >Undo</button>
          {/if}
          <button
            onclick={() => toasts.dismiss(toast.id)}
            aria-label="Dismiss notification"
            class="tap shrink-0 text-surface-400 hover:text-surface-100 bg-transparent border-none px-1 text-base leading-none"
          >&times;</button>
        </div>
        {#if toast.durationMs !== null}
          <div class="h-1 bg-surface-700 motion-reduce:hidden" aria-hidden="true">
            <div class="toast-progress h-full w-full bg-primary-400" style={`animation-duration: ${toast.durationMs}ms`}></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-progress {
    transform-origin: left;
    animation-name: toast-countdown;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }

  @keyframes toast-countdown {
    to { transform: scaleX(0); }
  }
</style>
