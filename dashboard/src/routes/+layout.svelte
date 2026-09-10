<script lang="ts">
  import "../app.css";
  import Assistant from "$lib/assistant/Assistant.svelte";

  let { children } = $props();
</script>

{@render children?.()}

<!-- One instance for the whole app, so a turn survives navigation between pages. -->
<Assistant />
