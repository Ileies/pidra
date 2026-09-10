<script lang="ts">
  import { goto } from "$app/navigation";
  import Panel from "$lib/assistant/Panel.svelte";
  import { assistant, setPageContext } from "$lib/assistant/state.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /**
   * The full-screen form of the same assistant: the conversation list and the correction sidebar
   * around the shared `Panel`. There is one transcript implementation, and one live conversation -
   * a turn started in the floating widget continues here.
   */

  // Hydrate the shared state from whichever conversation the URL selects.
  $effect(() => {
    assistant.adopt(data.activeId, data.messages);
  });

  // A turn that created a conversation moves the URL onto it, which also refreshes the sidebar
  // and the corrections list from Postgres.
  $effect(() => {
    if (assistant.conversationId && assistant.conversationId !== data.activeId && !assistant.streaming) {
      goto(`/chat?c=${assistant.conversationId}`, { invalidateAll: true, noScroll: true });
    }
  });

  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/chat",
      digest: `Kontext-Chat. ${data.corrections.length} aktive Korrekturen über der Analyse.`,
    });
  });

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  function fmtTs(value: string): string {
    return new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  const SURFACE_LABEL: Record<string, string> = {
    notes: "Notes",
    context: "Kontext",
    entities: "Entities",
    report: "Briefing",
    sources: "Quellen",
    prompts: "Prompts",
    global: "Allgemein",
  };
</script>

<svelte:head>
  <title>PIDRA - Assistent</title>
</svelte:head>

<div class="flex flex-col h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Assistent</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/context-builder" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">Context Builder</a>
      <a href="/notes" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">Notes</a>
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 min-h-0 w-full max-w-6xl mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
    <!-- Conversations -->
    <aside class="flex flex-col gap-2 order-2 lg:order-1 min-h-0 overflow-y-auto">
      <button
        class="{navBtn} border-primary-700 text-primary-400 hover:bg-surface-800 cursor-pointer text-left"
        onclick={() => assistant.newConversation()}
      >
        + Neues Gespräch
      </button>
      {#each data.conversations as conversation}
        <a
          href="/chat?c={conversation.id}"
          class="px-3 py-2 rounded border text-xs no-underline transition-colors {conversation.id === assistant.conversationId
            ? 'bg-surface-800 border-surface-600 text-surface-100'
            : 'bg-surface-950 border-surface-800 text-surface-400 hover:bg-surface-900'}"
        >
          <div class="line-clamp-2">{conversation.title ?? "Ohne Titel"}</div>
          <div class="text-surface-600 mt-1 flex items-center gap-2">
            <span>{fmtTs(conversation.updated_at)}</span>
            {#if conversation.surface}
              <span class="text-surface-500">· {SURFACE_LABEL[conversation.surface] ?? conversation.surface}</span>
            {/if}
          </div>
        </a>
      {/each}
    </aside>

    <!-- Transcript, the same component the floating widget uses -->
    <section class="order-1 lg:order-2 min-w-0 min-h-0 flex flex-col rounded-lg border border-surface-800 bg-surface-950">
      <Panel variant="page" />
    </section>

    <!-- Active corrections -->
    <aside class="order-3 flex flex-col gap-2 min-w-0 min-h-0 overflow-y-auto">
      <h2 class="text-surface-300 text-xs font-semibold uppercase tracking-wide">Aktive Korrekturen</h2>
      {#if data.corrections.length === 0}
        <p class="text-surface-600 text-xs">Noch keine.</p>
      {:else}
        {#each data.corrections as correction}
          <div class="rounded border border-surface-800 bg-surface-950 px-3 py-2 text-xs">
            <div class="text-surface-500">
              <code>{correction.target_kind}</code> · {correction.operation}
            </div>
            <div class="text-surface-200 mt-1 break-words">{correction.statement}</div>
            {#if correction.supersedes_text}
              <div class="text-surface-600 mt-1 line-through break-words">{correction.supersedes_text}</div>
            {/if}
          </div>
        {/each}
        <a href="/context-builder" class="text-surface-500 text-xs hover:text-surface-300">Alle ansehen und zurücknehmen →</a>
      {/if}
    </aside>
  </main>
</div>
