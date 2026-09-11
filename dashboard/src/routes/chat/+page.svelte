<script lang="ts">
  import { goto } from "$app/navigation";
  import Panel from "$lib/assistant/Panel.svelte";
  import { assistant, setPageContext } from "$lib/assistant/state.svelte";
  import { fmtDateTimeShort } from "$lib/format";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /**
   * The full-screen form of the same assistant: the conversation list and the correction sidebar
   * around the shared `Panel`. There is one transcript implementation, and one live conversation -
   * a turn started in the floating widget continues here.
   *
   * This page does not use `<Page>`: it owns the viewport and scrolls inside its own panes rather
   * than scrolling as a document.
   *
   * Below `lg` the three panes used to stack and each keep its own `overflow-y-auto`, so a phone
   * got three independently scrolling regions in a box that was also the wrong height (M11).
   * Now exactly one pane is on screen at a time and the other two are behind a segmented control,
   * so the transcript gets the whole height instead of whatever is left over.
   */

  type MobileView = "chat" | "conversations" | "corrections";
  let view = $state<MobileView>("chat");

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
      digest: `Context chat. ${data.corrections.length} active corrections above the harvest.`,
    });
  });

  const SURFACE_LABEL: Record<string, string> = {
    notes: "Notes",
    context: "Context",
    entities: "Entities",
    report: "Briefing",
    sources: "Sources",
    prompts: "Prompts",
    global: "General",
  };

  const VIEWS: [MobileView, string][] = [
    ["conversations", "Chats"],
    ["chat", "Transcript"],
    ["corrections", "Corrections"],
  ];
</script>

<svelte:head>
  <title>PIDRA - Assistant</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0 w-full max-w-app mx-auto px-4 sm:px-6 lg:px-8 py-3 lg:py-6 gap-3
            pb-[calc(3.5rem+var(--safe-b))] sm:pb-3 lg:pb-6">
  <!-- Below lg: one pane at a time. -->
  <div class="lg:hidden grid grid-cols-3 gap-1 rounded-lg border border-surface-700 bg-surface-900 p-1 shrink-0">
    {#each VIEWS as [key, viewLabel] (key)}
      <button
        type="button"
        aria-pressed={view === key}
        onclick={() => (view = key)}
        class="tap rounded px-2 py-1.5 text-xs transition-colors cursor-pointer border-none
          {view === key ? 'bg-surface-700 text-surface-50' : 'bg-transparent text-surface-400'}"
      >
        {viewLabel}{key === "corrections" && data.corrections.length > 0 ? ` (${data.corrections.length})` : ""}
      </button>
    {/each}
  </div>

  <div class="flex-1 min-h-0 lg:grid lg:gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
    <!-- Conversations -->
    <aside
      class="flex-col gap-2 min-h-0 overflow-y-auto {view === 'conversations' ? 'flex' : 'hidden'} lg:flex"
      aria-label="Conversations"
    >
      <button
        class="tap nav-btn border-primary-700 text-primary-300 hover:bg-surface-800 cursor-pointer text-left"
        onclick={() => {
          assistant.newConversation();
          view = "chat";
        }}
      >
        + New chat
      </button>
      {#each data.conversations as conversation (conversation.id)}
        <a
          href="/chat?c={conversation.id}"
          class="tap px-3 py-2 rounded border text-xs no-underline transition-colors {conversation.id === assistant.conversationId
            ? 'bg-surface-800 border-surface-500 text-surface-100'
            : 'bg-surface-950 border-surface-800 text-surface-300 hover:bg-surface-900'}"
        >
          <span class="line-clamp-2 block">{conversation.title ?? "Untitled"}</span>
          <span class="text-surface-400 mt-1 flex items-center gap-2">
            <span>{fmtDateTimeShort(conversation.updated_at)}</span>
            {#if conversation.surface}
              <span>· {SURFACE_LABEL[conversation.surface] ?? conversation.surface}</span>
            {/if}
          </span>
        </a>
      {/each}
    </aside>

    <!-- Transcript, the same component the floating widget uses -->
    <section
      class="min-w-0 min-h-0 flex-col rounded-lg border border-surface-800 bg-surface-950 {view === 'chat' ? 'flex' : 'hidden'} lg:flex"
    >
      <Panel variant="page" />
    </section>

    <!-- Active corrections -->
    <aside
      class="flex-col gap-2 min-w-0 min-h-0 overflow-y-auto {view === 'corrections' ? 'flex' : 'hidden'} lg:flex"
      aria-label="Active corrections"
    >
      <h2 class="text-surface-200 text-xs font-semibold uppercase tracking-wide">Active corrections</h2>
      {#if data.corrections.length === 0}
        <p class="text-surface-400 text-xs">None yet.</p>
      {:else}
        {#each data.corrections as correction (correction.id)}
          <div class="rounded border border-surface-800 bg-surface-950 px-3 py-2 text-xs">
            <div class="text-surface-400">
              <code>{correction.target_kind}</code> · {correction.operation}
            </div>
            <div class="text-surface-200 mt-1 break-words">{correction.statement}</div>
            {#if correction.supersedes_text}
              <div class="text-surface-400 mt-1 line-through break-words">{correction.supersedes_text}</div>
            {/if}
          </div>
        {/each}
        <a href="/context-builder" class="text-surface-400 text-xs hover:text-surface-200">See all and revert →</a>
      {/if}
    </aside>
  </div>
</div>
