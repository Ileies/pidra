<script lang="ts">
  /**
   * One badge (B2). Five files carried an ad-hoc `badge` class plus their own colour map.
   *
   * A tone is never the whole message: the badge always contains a word, because hue alone is
   * not readable for everyone and does not exist at all on a monochrome print or a colour-blind
   * screen (A4, P7). Where a caller wants a glyph too it goes *beside* the text, not instead.
   */
  import type { Snippet } from "svelte";

  export type Tone = "neutral" | "muted" | "primary" | "success" | "warning" | "error";

  interface Props {
    tone?: Tone;
    /** Slightly stronger fill, for a badge that is the point of its row rather than metadata. */
    solid?: boolean;
    title?: string;
    class?: string;
    children: Snippet;
  }

  let { tone = "neutral", solid = false, title, class: extra = "", children }: Props = $props();

  const TONES: Record<Tone, string> = {
    neutral: "bg-surface-950 border-surface-700 text-surface-200",
    muted: "bg-surface-900 border-surface-700 text-surface-400",
    primary: "bg-primary-950 border-primary-800 text-primary-300",
    success: "bg-success-950 border-success-800 text-success-400",
    warning: "bg-warning-950 border-warning-800 text-warning-400",
    error: "bg-error-950 border-error-800 text-error-400",
  };

  const SOLID: Record<Tone, string> = {
    neutral: "bg-surface-800 border-surface-600 text-surface-100",
    muted: "bg-surface-800 border-surface-600 text-surface-300",
    primary: "bg-primary-900 border-primary-700 text-primary-200",
    success: "bg-success-900 border-success-700 text-success-200",
    warning: "bg-warning-900 border-warning-700 text-warning-200",
    error: "bg-error-900 border-error-700 text-error-200",
  };
</script>

<span class="badge border {solid ? SOLID[tone] : TONES[tone]} {extra}" {title}>
  {@render children()}
</span>
