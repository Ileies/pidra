<script lang="ts">
  /** Placeholder rows while a table loads (E2). Pulse stops under prefers-reduced-motion. */
  interface Props {
    rows?: number;
    /** Tailwind height class per row. */
    height?: string;
  }

  let { rows = 5, height = "h-9" }: Props = $props();
</script>

<div class="flex flex-col gap-2" aria-hidden="true">
  {#each Array(rows) as _, i (i)}
    <div class="{height} rounded bg-surface-900 border border-surface-800 animate-pulse"></div>
  {/each}
</div>
