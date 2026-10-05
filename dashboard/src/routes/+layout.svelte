<script lang="ts">
  import "../app.css";
  import { browser } from "$app/env";
  import { page } from "$app/state";
  import type { Attachment } from "svelte/attachments";
  import Navbar from "#lib/components/Navbar.svelte";
  import ServerStatus from "#lib/components/ServerStatus.svelte";
  import TabBar from "#lib/components/TabBar.svelte";
  import Toast from "#lib/components/Toast.svelte";
  import CommandPalette from "#lib/components/CommandPalette.svelte";
  import Shortcuts from "#lib/components/Shortcuts.svelte";
  import Assistant from "#lib/assistant/Assistant.svelte";
  import { assistant } from "#lib/assistant/state.svelte.js";
  import SyncSheet from "#lib/offline/SyncSheet.svelte";
  import FirstSync from "#lib/offline/FirstSync.svelte";
  import { navBadges } from "#lib/navBadges.svelte.js";
  import { navigating } from "$app/state";
  import { beforeNavigate } from "$app/navigation";
  import { MIRRORED_ROUTES } from "#lib/offline/tiers.js";
  import { navOrigin } from "#lib/navOrigin.svelte.js";
  import { startClient } from "#lib/startClient.js";

  let { children } = $props();

  beforeNavigate(({ from, to, type }) => {
    if (!from || !to || type === "leave") return;
    navOrigin.record({ url: from.url, routeId: from.route.id }, to.url);
  });

  /**
   * Whether to show the logged-in chrome (navbar, tab bar, assistant, command palette). Read
   * straight from `pidra_ui` - a non-`httpOnly` companion to the real session cookie
   * (`$lib/server/auth.ts`) - rather than from a `+layout.server.ts` load: a server load on the
   * root layout is inherited by every route, including the offline-first mirrored ones, which
   * must never wait on a network round trip (CLAUDE.md, offline mode). The cookie carries no
   * authority; `hooks.server.ts` still gates every route server-side. Re-read on every navigation
   * (`page.url` as the dependency) because login/logout is an SPA `goto`, not a full reload.
   */
  const loggedIn = $derived.by(() => {
    void page.url;
    return browser && document.cookie.split("; ").includes("pidra_ui=1");
  });

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

  $effect(() => startClient(loggedIn));

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
   * Re-runs when `loggedIn` flips, because the header only exists while the logged-in chrome does.
   */
  const publishHeaderHeight: Attachment<HTMLDivElement> = (shell) => {
    void loggedIn;
    const header = shell.querySelector<HTMLElement>("[data-app-header]");
    if (!header) return;

    const publish = () => shell.style.setProperty("--header-h", `${header.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  };
</script>

<!-- Navbar and shell live here, above the swapped-out page, so navigating never unmounts the
     header. Mounting it per page made every click rebuild the button row for a frame. -->
<div {@attach publishHeaderHeight} class="flex flex-col {fullHeight ? 'h-dvh' : 'min-h-dvh'}">
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

  {#if loggedIn}
    <Navbar />
    <ServerStatus />
  {/if}

  <div id="main-content" class="flex flex-1 flex-col min-h-0">
    {#if firstSync}
      <FirstSync />
    {:else}
      {@render children?.()}
    {/if}
  </div>
</div>

{#if loggedIn}
  <TabBar open={moreOpen} onOpenChange={(open) => (moreOpen = open)} />
{/if}

<!-- One instance each for the whole app, so a turn and an undo offer both survive navigation.
     Assistant and the command palette are gated the same as the navbar: both reach account data
     (a chat turn, the route registry) that a logged-out visitor should not have. -->
{#if loggedIn}
  <Assistant />
  <CommandPalette open={searchOpen} onOpenChange={(open) => (searchOpen = open)} />
{/if}
<SyncSheet />
<Toast />
<!-- Every global key binding lives in one component, which is how the Ctrl+K collision between
     search and the assistant stays settled rather than re-emerging. -->
<Shortcuts onOpenSearch={() => (searchOpen = true)} onToggleAssistant={() => assistant.toggle()} />
