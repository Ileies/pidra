<script lang="ts">
  import { page } from "$app/state";
  import { assistant } from "$lib/assistant/state.svelte";
  import Panel from "$lib/assistant/Panel.svelte";

  /**
   * The floating assistant: one button, bottom right, on every page. Mounted once in the root
   * layout, so a turn keeps streaming while the user navigates.
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

  function onWindowKeydown(event: KeyboardEvent) {
    const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (cmdK) {
      event.preventDefault();
      assistant.toggle();
      return;
    }

    if (event.key === "Escape" && assistant.open) {
      // Esc cancels a running turn first, and only closes the panel when nothing is in flight.
      if (assistant.streaming) assistant.cancel();
      else assistant.close();
    }
  }

  const label = $derived(assistant.info?.label ?? "Assistent");

  // /chat is the assistant, full screen. A floating copy of it on top of itself is noise.
  const hidden = $derived(page.url.pathname.startsWith("/chat"));
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if assistant.open && !hidden}
  <div
    bind:this={panel}
    role="dialog"
    aria-label="PIDRA Assistent"
    class="fixed z-40 flex flex-col bg-surface-950 border border-surface-700 shadow-2xl
           inset-0 rounded-none
           sm:inset-auto sm:bottom-5 sm:right-5 sm:rounded-xl
           {assistant.expanded ? 'sm:w-[40rem] sm:h-[85vh]' : 'sm:w-[26rem] sm:h-[70vh]'}"
  >
    <header class="flex items-center gap-2 px-4 py-2 border-b border-surface-800 bg-surface-900 sm:rounded-t-xl">
      <span class="text-xs font-semibold tracking-wide text-surface-200">{label}</span>
      {#if assistant.info?.notice}
        <span class="text-xs text-warning-500 truncate">· final</span>
      {/if}
      <a
        href={assistant.conversationId ? `/chat?c=${assistant.conversationId}` : "/chat"}
        class="ml-auto text-xs text-surface-500 hover:text-surface-300 no-underline"
        title="Im vollen Chat öffnen"
      >Vollbild</a>
      <button
        onclick={() => (assistant.expanded = !assistant.expanded)}
        aria-label={assistant.expanded ? "Verkleinern" : "Vergrößern"}
        class="hidden sm:block text-surface-500 hover:text-surface-200 text-xs cursor-pointer bg-transparent border-none px-1"
      >{assistant.expanded ? "⤡" : "⤢"}</button>
      <button
        onclick={() => assistant.close()}
        aria-label="Assistent schließen"
        class="text-surface-500 hover:text-surface-200 text-sm cursor-pointer bg-transparent border-none px-1"
      >✕</button>
    </header>

    <Panel variant="widget" />
  </div>
{/if}

<!-- Only while closed: the panel occupies this corner, and the button sat on top of it. Closing
     happens in the panel header, with Esc, or with Strg+K. -->
{#if !hidden && !assistant.open}
<button
  onclick={() => assistant.toggle()}
  aria-label="Assistent öffnen"
  title="Assistent (Strg+K)"
  class="group fixed bottom-5 right-5 z-50 h-14 w-14 p-0 border-none bg-transparent
         cursor-pointer flex items-center justify-center
         drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)] transition-transform duration-150
         hover:scale-110 hover:drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)]
         active:scale-95
         focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-400 focus-visible:outline-offset-4 rounded-full"
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
