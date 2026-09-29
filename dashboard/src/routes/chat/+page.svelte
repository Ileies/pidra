<script lang="ts">
  import { goto } from "$app/navigation";
  import Panel from "#lib/assistant/Panel.svelte";
  import ConversationList from "#lib/assistant/ConversationList.svelte";
  import { assistant, setPageContext } from "#lib/assistant/state.svelte.js";
  import Badge from "#lib/components/Badge.svelte";
  import { label } from "#lib/labels.js";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  /**
   * The full-screen form of the same assistant: the conversation list and the correction sidebar
   * around the shared `Panel`. There is one transcript implementation, and one live conversation -
   * a turn started in the floating widget continues here.
   *
   * This page does not use `<Page>`: it owns the viewport and scrolls inside its own panes rather
   * than scrolling as a document, and `<Page>`'s padding/title handling is built for a document
   * that scrolls as a whole, which this deliberately does not.
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
      goto(`/chat?c=${assistant.conversationId}`, { refreshAll: true, reset: false });
    }
  });

  $effect(() => {
    setPageContext({
      surface: "context",
      route: "/chat",
      digest: `Context chat. ${data.corrections.length} active corrections above the harvest.`,
    });
  });

  function newConversation() {
    assistant.newConversation();
    view = "chat";
  }

  /** The conversation the URL points at was just deleted: fall back to whatever is newest now. */
  function onDeletedActive() {
    assistant.newConversation();
    goto("/chat", { invalidateAll: true });
  }

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
            pb-[calc(3.5rem+var(--safe-b))] xl:pb-3 2xl:pb-6">
  <!-- Below lg: one pane at a time. -->
  <div class="lg:hidden grid grid-cols-3 gap-1.5 shrink-0">
    {#each VIEWS as [key, viewLabel] (key)}
      <button
        type="button"
        aria-pressed={view === key}
        onclick={() => (view = key)}
        class="tap nav-btn text-center cursor-pointer {view === key ? 'nav-btn-active' : 'nav-btn-muted'}"
      >
        {viewLabel}{key === "corrections" && data.corrections.length > 0 ? ` (${data.corrections.length})` : ""}
      </button>
    {/each}
  </div>

  <div class="flex-1 min-h-0 lg:grid lg:gap-6 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
    <!-- Conversations -->
    <aside
      class="min-h-0 {view === 'conversations' ? 'flex' : 'hidden'} lg:flex flex-col"
      aria-label="Conversations"
    >
      <ConversationList
        conversations={data.conversations}
        activeId={assistant.conversationId}
        onNewConversation={newConversation}
        onSelect={() => (view = "chat")}
        {onDeletedActive}
      />
    </aside>

    <!-- Transcript, the same component the floating widget uses -->
    <section
      class="min-w-0 min-h-0 flex-col rounded-lg border border-surface-800 bg-surface-950 {view === 'chat' ? 'flex' : 'hidden'} lg:flex"
    >
      <Panel variant="page" />
    </section>

    <!-- Active corrections -->
    <aside
      class="min-w-0 min-h-0 {view === 'corrections' ? 'flex' : 'hidden'} lg:flex flex-col"
      aria-label="Active corrections"
    >
      <div class="rounded-lg border border-surface-800 bg-surface-900 p-4 flex flex-col gap-3 min-h-0">
        <h2 class="text-surface-400 text-xs font-semibold uppercase tracking-wide shrink-0">Active corrections</h2>
        {#if data.corrections.length === 0}
          <p class="text-surface-400 text-xs">None yet.</p>
        {:else}
          <div class="flex flex-col gap-2 overflow-y-auto min-h-0">
            {#each data.corrections as correction (correction.id)}
              <div class="rounded-lg border border-surface-800 bg-surface-950 px-3 py-2 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Badge tone="primary">{label(correction.target_kind)}</Badge>
                  <Badge tone="muted">{label(correction.operation)}</Badge>
                </div>
                <div class="text-surface-200 mt-1.5 break-words">{correction.statement}</div>
                {#if correction.supersedes_text}
                  <div class="text-surface-500 mt-1 line-through break-words">{correction.supersedes_text}</div>
                {/if}
              </div>
            {/each}
          </div>
          <a href="/context-builder" class="text-surface-400 text-xs hover:text-surface-200 shrink-0">See all and revert →</a>
        {/if}
      </div>
    </aside>
  </div>
</div>
