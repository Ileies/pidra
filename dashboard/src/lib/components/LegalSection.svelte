<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section class="space-y-2">
  <h2 class="text-lg font-semibold text-surface-50">{title}</h2>
  {@render children()}
</section>
