<script lang="ts">
  /**
   * The one spinner. Replaces the "loading…" text swaps.
   *
   * `prefers-reduced-motion` stops the spin globally (A5), so this degrades to a static ring
   * rather than disappearing - a still marker is still a marker.
   */
  interface Props {
    /** Matches the surrounding text size by default. */
    size?: "sm" | "md";
    label?: string;
  }

  let { size = "sm", label = "Loading" }: Props = $props();
</script>

<span
  role="status"
  aria-label={label}
  class="inline-block rounded-full border-2 border-surface-600 border-t-primary-400 animate-spin align-[-0.125em]
    {size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'}"
></span>
