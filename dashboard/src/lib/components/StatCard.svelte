<script lang="ts">
  /** One figure with its label and, where the figure needs it, the sentence behind it. */
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    value: string | number;
    /** What the figure is made of. Shown small under the value. */
    hint?: string;
    /** Colour on the value only, e.g. a score. The label always carries the meaning. */
    tone?: "default" | "success" | "warning" | "error" | "muted";
    children?: Snippet;
  }

  let { label, value, hint, tone = "default", children }: Props = $props();

  const TONES = {
    default: "text-surface-50",
    success: "text-success-500",
    warning: "text-warning-500",
    error: "text-error-500",
    muted: "text-surface-400",
  } as const;
</script>

<div class="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2.5">
  <div class="text-xs text-surface-400">{label}</div>
  <div class="text-base font-semibold tabular-nums {TONES[tone]}">{value}</div>
  {#if hint}
    <div class="text-xs text-surface-400 leading-tight mt-0.5 opacity-80">{hint}</div>
  {/if}
  {@render children?.()}
</div>
