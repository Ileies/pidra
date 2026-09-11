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
  class="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full border border-primary-700 bg-primary-900 text-primary-200
         shadow-lg hover:bg-primary-800 cursor-pointer transition-colors flex items-center justify-center"
>
  {#if assistant.streaming}
    <span class="h-3 w-3 rounded-full bg-primary-300 animate-pulse"></span>
  {:else}
    <span class="text-lg leading-none">✳</span>
  {/if}
  {#if assistant.unseen}
    <span class="absolute top-0 right-0 h-3 w-3 rounded-full bg-warning-500 border border-surface-950"></span>
  {/if}
</button>
{/if}
