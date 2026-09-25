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
  import SyncSheet from "#lib/offline/SyncSheet.svelte";
  import FirstSync from "#lib/offline/FirstSync.svelte";
  import { appUpdate } from "#lib/offline/update.svelte.js";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import { navigating } from "$app/state";
  import { MIRRORED_ROUTES } from "#lib/routes.js";

  let { children } = $props();

  // A mirrored page whose load found the mirror empty: first launch, or right after "Clear offline
  // data". Decided from the load's own answer, so the first frame is already the right one.
  const firstSync = $derived(page.data.mirrorEmpty === true);

  // Whenever the page's data reloads - a navigation, or a form action's invalidation - the badge
  // counts may have moved. Read `page.data` so the effect re-runs on each reload; the fetch itself
  // is background and throttled, and nothing waits for it.
  $effect(() => {
    void page.data;
    void navBadges.refresh();
  });

  $effect(() => {
    appUpdate.start();
  });

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
  <!-- Only a server load is worth a bar: a mirrored page renders from IndexedDB in milliseconds,
       and the bar only flashed there. Its first-sync wait has its own screen. -->
  {#if navigating.to && !MIRRORED_ROUTES.has(navigating.to.route.id ?? "")}
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

  {#if appUpdate.ready}
    <!-- Never automatic: taking over mid-read would reload the page under the reader. -->
    <div role="status" class="flex items-center justify-center gap-3 border-b border-surface-700 bg-surface-900 px-4 py-2 text-xs text-surface-300">
      <span>A new version of PIDRA is ready.</span>
      <button
        type="button"
        onclick={() => appUpdate.apply()}
        class="tap rounded border border-primary-700 bg-primary-900 px-3 py-1 text-primary-200 hover:bg-primary-800 cursor-pointer"
      >Reload</button>
    </div>
  {/if}

  <div id="main-content" class="flex flex-1 flex-col min-h-0">
    {#if firstSync}
      <FirstSync />
    {:else}
      {@render children?.()}
    {/if}
  </div>
</div>

<TabBar open={moreOpen} onOpenChange={(open) => (moreOpen = open)} />

<!-- One instance each for the whole app, so a turn and an undo offer both survive navigation. -->
<Assistant />
<SyncSheet />
<Toast />
<CommandPalette open={searchOpen} onOpenChange={(open) => (searchOpen = open)} />
<!-- Every global key binding lives in one component, which is how the Ctrl+K collision between
     search and the assistant stays settled rather than re-emerging. -->
<Shortcuts onOpenSearch={() => (searchOpen = true)} onToggleAssistant={() => assistant.toggle()} />
