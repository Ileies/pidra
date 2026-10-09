<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import MessagesSquare from "@lucide/svelte/icons/messages-square";
  import Plus from "@lucide/svelte/icons/plus";
  import Panel from "#lib/assistant/Panel.svelte";
  import ConversationList from "#lib/assistant/ConversationList.svelte";
  import { assistant, setPageContext } from "#lib/assistant/state.svelte.js";
  import CorrectionsSidebar from "#lib/assistant/CorrectionsSidebar.svelte";
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
   * Below `lg` exactly one pane is on screen at a time (the other sits behind a segmented
   * control), so the transcript gets the whole height instead of nested scrollers. Corrections
   * are a collapsed section under the conversation list there.
   *
   * Data: `+page.server.ts` reads conversations, the active transcript (`?c=<id>`) and active
   * corrections from Postgres; online-only. Sending goes through the shared `assistant` state.
   */

  type MobileView = "chat" | "conversations";
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
      // Arrived with the live conversation still in memory (a client-side navigation): the effect
      // below moves the URL onto it, so do not clear it with the empty page the URL asked for.
      if (first && id === null && assistant.conversationId) return;
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
      // Replacing from the empty URL keeps Back from bouncing into a redirect loop.
      goto(`/chat?c=${assistant.conversationId}`, {
        refreshAll: true,
        reset: false,
        replaceState: data.activeId === null,
      });
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

</script>

<svelte:head>
  <title>PIDRA - Assistant</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0 w-full max-w-app mx-auto px-0 lg:px-8 pt-3 lg:pt-6 gap-3
            pb-[calc(3.5rem+1px+var(--safe-b))] lg:pb-6">
  <!-- Below lg: one pane at a time, with New chat always in reach. Below `lg` the page has no side
       padding so the transcript can use the full width; the rows that are not the transcript
       carry their own gutter instead. -->
  <div class="lg:hidden flex gap-2 shrink-0 px-4">
    <button
      type="button"
      onclick={() => (view = "conversations")}
      aria-pressed={view === "conversations"}
      aria-label="Chats"
      title="Chats"
      class="btn btn-icon btn-ghost h-11 w-11 {view === 'conversations' ? 'bg-surface-800' : ''}"
    >
      <MessagesSquare class="h-5 w-5" aria-hidden="true" />
    </button>
    <button
      type="button"
      onclick={newConversation}
      disabled={assistant.streaming}
      aria-label="New chat"
      title="New chat"
      class="btn btn-icon btn-primary h-11 w-11"
    >
      <Plus class="h-5 w-5" aria-hidden="true" />
    </button>
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
      <!-- Below lg corrections live here, collapsed, instead of in a pane of their own. -->
      <details class="lg:hidden shrink-0 mt-3 max-h-[50%] overflow-y-auto">
        <summary class="cursor-pointer text-surface-400 text-xs font-semibold uppercase tracking-wide py-2">
          Active corrections{data.corrections.length > 0 ? ` (${data.corrections.length})` : ""}
        </summary>
        <CorrectionsSidebar corrections={data.corrections} />
      </details>
    </aside>

    <!-- Transcript, the same component the floating widget uses -->
    <section
      class="min-w-0 min-h-0 flex-1 flex-col rounded-none border-x-0 lg:rounded-lg lg:border-x border-y border-surface-800 bg-surface-950 {view === 'chat' ? 'flex' : 'hidden'} lg:flex"
    >
      <Panel variant="page" />
    </section>

    <!-- Active corrections -->
    <aside
      class="min-w-0 min-h-0 flex-1 px-4 lg:px-0 hidden lg:flex flex-col"
      aria-label="Active corrections"
    >
      <CorrectionsSidebar corrections={data.corrections} />
    </aside>
  </div>
</div>
