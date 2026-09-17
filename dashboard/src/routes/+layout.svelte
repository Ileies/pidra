<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import Navbar from "#lib/components/Navbar.svelte";
  import TabBar from "#lib/components/TabBar.svelte";
  import Toast from "#lib/components/Toast.svelte";
  import CommandPalette from "#lib/components/CommandPalette.svelte";
  import Shortcuts from "#lib/components/Shortcuts.svelte";
  import Assistant from "#lib/assistant/Assistant.svelte";
  import { assistant } from "#lib/assistant/state.svelte.js";
  import { navigating } from "$app/state";

  let { children } = $props();

  // The chat owns the viewport and scrolls inside its own panes; every other page scrolls whole.
  // `dvh`, not `vh`: mobile browser chrome makes 100vh taller than the visible area, which put
  // the chat composer under the URL bar (M6).
  const fullHeight = $derived(page.route.id === "/chat");

  let moreOpen = $state(false);
  let searchOpen = $state(false);

  /**
   * Publish the real header height as `--header-h` (M-6, X6). Every sticky element references
   * it instead of hard-coding `top-14`, which was a desktop-only 56px and left the notes bulk
   * bar hidden underneath the wrapped mobile header.
   */
  let shell = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!shell) return;
    const header = shell.querySelector<HTMLElement>("[data-app-header]");
    if (!header) return;

    const publish = () => shell?.style.setProperty("--header-h", `${header.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  });
</script>

<!-- Navbar and shell live here, above the swapped-out page, so navigating never unmounts the
     header. Mounting it per page made every click rebuild the button row for a frame. -->
<div bind:this={shell} class="flex flex-col {fullHeight ? 'h-dvh' : 'min-h-dvh'}">
  <!-- E2: a navigation that has to hit the database should say so before the page swaps. -->
  {#if navigating.to}
    <div class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden" role="status" aria-label="Loading">
      <div class="h-full w-1/3 animate-[loadbar_1.1s_ease-in-out_infinite] bg-primary-400"></div>
    </div>
  {/if}

  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-surface-800 focus:px-3 focus:py-2 focus:text-sm focus:text-surface-50"
  >
    Skip to content
  </a>

  <Navbar onOpenMore={() => (moreOpen = true)} />

  <div id="main-content" class="flex flex-1 flex-col min-h-0">
    {@render children?.()}
  </div>
</div>

<TabBar open={moreOpen} onOpenChange={(open) => (moreOpen = open)} />

<!-- One instance each for the whole app, so a turn and an undo offer both survive navigation. -->
<Assistant />
<Toast />
<CommandPalette open={searchOpen} onOpenChange={(open) => (searchOpen = open)} />
<!-- Every global key binding lives in one component, which is how the Ctrl+K collision between
     search and the assistant stays settled rather than re-emerging. -->
<Shortcuts onOpenSearch={() => (searchOpen = true)} onToggleAssistant={() => assistant.toggle()} />
