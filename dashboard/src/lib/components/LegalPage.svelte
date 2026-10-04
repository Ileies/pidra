<script lang="ts">
  /** Shared frame of the privacy policy and terms: the page, a titled header with its effective date, then sections. */
  import type { Snippet } from "svelte";
  import Page from "#lib/components/Page.svelte";

  interface Props {
    title: string;
    effective: string;
    intro: Snippet;
    children: Snippet;
  }

  let { title, effective, intro, children }: Props = $props();
</script>

<Page {title} size="legal" class="space-y-7 text-sm leading-7 text-surface-300">
  <header class="space-y-3">
    <h1 class="text-2xl font-bold text-surface-50">{title}</h1>
    <p>Effective {effective}</p>
    <p>{@render intro()}</p>
  </header>

  {@render children()}
</Page>
