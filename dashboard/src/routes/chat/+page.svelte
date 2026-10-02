<script lang="ts">
  import { untrack } from "svelte";
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

  // Hydrate the shared state from whichever conversation the URL selects. Only `data` is tracked:
  // reading the assistant's own state here made this re-run when a turn finished, and re-adopt the
  // old conversation over the new one the turn had just created, so the redirect below never fired.
  let lastActive: string | null | undefined = undefined;
  $effect(() => {
    const id = data.activeId;
    const rows = data.messages;
    untrack(() => {
      const first = lastActive === undefined;
      const navigated = !first && id !== lastActive;
      lastActive = id;
      // A navigation inside this page is an explicit choice of conversation, so it overrides an
      // empty composer; a reload that merely lags behind the live conversation does not.
      if (navigated) assistant.composingNew = false;
      else if (!first && id !== assistant.conversationId) return;
      assistant.adopt(id, rows);
    });
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
    if (assistant.streaming) return;
    assistant.newConversation();
    view = "chat";
    // Moves the URL off the old conversation, so choosing that one again in the list is a real
    // navigation and the loader stops handing its transcript to this page.
    goto("/chat?c=new", { reset: false });
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

<div class="flex flex-1 flex-col min-h-0 w-full max-w-app mx-auto px-0 lg:px-8 pt-3 lg:pt-6 gap-3
            pb-[calc(3.5rem+1px+var(--safe-b))] lg:pb-[calc(4.5rem+1px+var(--safe-b))] xl:pb-6">
  <!-- Below lg: one pane at a time, with New chat always in reach. Below `lg` the page has no side
       padding so the transcript can use the full width; the rows that are not the transcript
       carry their own gutter instead. -->
  <div class="lg:hidden flex gap-1.5 shrink-0 px-4">
    <div class="grid flex-1 grid-cols-3 gap-1.5">
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
    <button
      type="button"
      onclick={newConversation}
      disabled={assistant.streaming}
      aria-label="New chat"
      title="New chat"
      class="tap nav-btn shrink-0 cursor-pointer border-primary-700 text-primary-300 hover:bg-surface-800 disabled:opacity-40 disabled:cursor-not-allowed"
    >+ New</button>
  </div>

  <!-- A flex column below lg so the visible pane is bounded by the viewport and scrolls inside
       itself. As a plain block its height was its content, and a long transcript pushed the
       composer past the bottom of the screen, under the tab bar. -->
  <div class="flex flex-1 flex-col min-h-0 lg:grid lg:gap-6 lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:grid-rows-[minmax(0,1fr)]">
    <!-- Conversations -->
    <aside
      class="min-h-0 flex-1 px-4 lg:px-0 {view === 'conversations' ? 'flex' : 'hidden'} lg:flex flex-col"
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
      class="min-w-0 min-h-0 flex-1 flex-col rounded-none border-x-0 lg:rounded-lg lg:border-x border-y border-surface-800 bg-surface-950 {view === 'chat' ? 'flex' : 'hidden'} lg:flex"
    >
      <Panel variant="page" />
    </section>

    <!-- Active corrections -->
    <aside
      class="min-w-0 min-h-0 flex-1 px-4 lg:px-0 {view === 'corrections' ? 'flex' : 'hidden'} lg:flex flex-col"
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
