<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import Navbar from "$lib/components/Navbar.svelte";
  import Assistant from "$lib/assistant/Assistant.svelte";

  let { children } = $props();

  // The chat owns the viewport and scrolls inside its own panes; every other page scrolls whole.
  const fullHeight = $derived(page.route.id === "/chat");
</script>

<!-- Navbar and shell live here, above the swapped-out page, so navigating never unmounts the
     header. Mounting it per page made every click rebuild the button row for a frame. -->
<div class="flex flex-col {fullHeight ? 'h-screen' : 'min-h-screen'}">
  <Navbar />
  {@render children?.()}
</div>

<!-- One instance for the whole app, so a turn survives navigation between pages. -->
<Assistant />
