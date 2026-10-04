<script lang="ts">
  /** The bordered panel every page builds on. Padding and layout come from the caller's `class`. */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  interface Props extends HTMLAttributes<HTMLElement> {
    as?: "div" | "section" | "article" | "li" | "ul";
    tone?: "default" | "inset" | "warning" | "error";
    children: Snippet;
  }

  let { as = "div", tone = "default", class: extra = "", children, ...rest }: Props = $props();

  const TONES = {
    default: "border-surface-700 bg-surface-900",
    inset: "border-surface-800 bg-surface-950",
    warning: "border-warning-800 bg-warning-950",
    error: "border-error-800 bg-error-950",
  } as const;
</script>

<svelte:element this={as} class="rounded-lg border {TONES[tone]} {extra}" {...rest}>
  {@render children()}
</svelte:element>
