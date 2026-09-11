<script lang="ts">
  import { page } from "$app/state";
  import { assistant } from "$lib/assistant/state.svelte";
  import Panel from "$lib/assistant/Panel.svelte";

  /**
   * The floating assistant: one button, bottom right, on every page from `sm` up. Mounted once
   * in the root layout, so a turn keeps streaming while the user navigates.
   *
   * Below `sm` there is no launcher (M-7, decision 7). The panel already took the whole screen
   * there, so the button bought nothing and collided with the bottom bar, the toast and the iOS
   * home indicator; the bottom bar's Chat tab is the mobile entry point instead.
   *
   * Pages declare what they are showing with `setPageContext`; this only falls back to the route
   * so the header and the hints are right even on a page that declares nothing.
   */

  let panel = $state<HTMLDivElement | null>(null);

  $effect(() => {
    assistant.restore();
  });

  // Route fallback. A page's own `setPageContext` runs after this and wins.
  $effect(() => {
    assistant.setRoute(page.url.pathname);
  });

  // Opening and closing is Ctrl+J, owned by `Shortcuts.svelte` along with every other global
  // binding: search took Ctrl+K (D8, E1). Esc stays here, because what it cancels is local.
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && assistant.open) {
      // Esc cancels a running turn first, and only closes the panel when nothing is in flight.
      if (assistant.streaming) assistant.cancel();
      else assistant.close();
    }
  }

  const label = $derived(assistant.info?.label ?? "Assistant");

  // /chat is the assistant, full screen. A floating copy of it on top of itself is noise.
  const hidden = $derived(page.url.pathname.startsWith("/chat"));
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if assistant.open && !hidden}
  <div
    bind:this={panel}
    role="dialog"
    aria-label="PIDRA assistant"
    class="fixed z-40 flex flex-col bg-surface-950 border border-surface-700 shadow-2xl
           inset-0 rounded-none
           sm:inset-auto sm:bottom-5 sm:right-5 sm:rounded-xl
           {assistant.expanded ? 'sm:w-[40rem] sm:h-[85vh]' : 'sm:w-[26rem] sm:h-[70vh]'}"
  >
    <header class="flex items-center gap-2 px-4 py-2 border-b border-surface-800 bg-surface-900 sm:rounded-t-xl pt-[calc(0.5rem+var(--safe-t))] sm:pt-2">
      <span class="text-xs font-semibold tracking-wide text-surface-200">{label}</span>
      {#if assistant.info?.notice}
        <span class="text-xs text-warning-400 truncate">· final</span>
      {/if}
      <a
        href={assistant.conversationId ? `/chat?c=${assistant.conversationId}` : "/chat"}
        class="ml-auto text-xs text-surface-400 hover:text-surface-200 no-underline"
        title="Open in the full chat"
      >Full screen</a>
      <button
        onclick={() => (assistant.expanded = !assistant.expanded)}
        aria-label={assistant.expanded ? "Shrink" : "Expand"}
        class="hidden sm:block text-surface-400 hover:text-surface-200 text-xs cursor-pointer bg-transparent border-none px-1"
      >{assistant.expanded ? "⤡" : "⤢"}</button>
      <button
        onclick={() => assistant.close()}
        aria-label="Close assistant"
        class="tap text-surface-400 hover:text-surface-200 text-sm cursor-pointer bg-transparent border-none px-1"
      >✕</button>
    </header>

    <Panel variant="widget" />
  </div>
{/if}

<!-- Only while closed: the panel occupies this corner, and the button sat on top of it. Closing
     happens in the panel header, with Esc, or with Ctrl+J. -->
{#if !hidden && !assistant.open}
  <button
    onclick={() => assistant.toggle()}
    aria-label="Open assistant"
    title="Assistant (Ctrl+J)"
    class="group fixed z-50 hidden sm:flex h-14 w-14 p-0 border-none bg-transparent
           bottom-[calc(1.25rem+var(--safe-b))] right-5
           cursor-pointer items-center justify-center
           drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)] transition-transform duration-150
           hover:scale-110 hover:drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)]
           active:scale-95 rounded-full"
  >
    <svg viewBox="0 0 24 24" class="h-full w-full overflow-visible">
      <path
        d="M12 3C6.48 3 2 6.94 2 11.8c0 2.66 1.37 5.04 3.51 6.66-.12.99-.5 2.4-1.51 3.69a.5.5 0 0 0 .49.8c2.06-.42 3.66-1.24 4.7-1.87.9.24 1.85.37 2.81.37 5.52 0 10-3.94 10-8.65C22 6.94 17.52 3 12 3Z"
        class="fill-primary-900 stroke-primary-500 transition-colors group-hover:fill-primary-800 group-hover:stroke-primary-400"
        stroke-width="1"
      />
      {#if assistant.streaming}
        <circle cx="7.8" cy="11.4" r="1.3" class="fill-primary-300 animate-bounce" style="animation-delay: 0ms" />
        <circle cx="12" cy="11.4" r="1.3" class="fill-primary-300 animate-bounce" style="animation-delay: 150ms" />
        <circle cx="16.2" cy="11.4" r="1.3" class="fill-primary-300 animate-bounce" style="animation-delay: 300ms" />
      {:else}
        <circle cx="7.8" cy="11.4" r="1.3" class="fill-primary-300" />
        <circle cx="12" cy="11.4" r="1.3" class="fill-primary-300" />
        <circle cx="16.2" cy="11.4" r="1.3" class="fill-primary-300" />
      {/if}
    </svg>
    {#if assistant.unseen}
      <span class="absolute top-0.5 right-1.5 h-3 w-3 rounded-full bg-warning-500 border-2 border-surface-950"></span>
    {/if}
  </button>
{/if}
