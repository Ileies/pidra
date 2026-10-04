<script lang="ts">
  import { enhance } from "$app/forms";
  import Badge from "#lib/components/Badge.svelte";
  import ConfirmButton from "#lib/components/ConfirmButton.svelte";
  import { fmtDateTimeShort } from "#lib/format.js";

  export interface ConversationRow {
    id: string;
    title: string | null;
    surface: string | null;
    updated_at: string;
    snippet: string | null;
  }

  interface Props {
    conversations: ConversationRow[];
    activeId: string | null;
    onSelect?: () => void;
    onNewConversation?: () => void;
    /** The active conversation was just deleted: the caller has to reset its own state and URL. */
    onDeletedActive?: () => void;
  }

  let { conversations, activeId, onSelect, onNewConversation, onDeletedActive }: Props = $props();

  const SURFACE_LABEL: Record<string, string> = {
    notes: "Notes",
    context: "Context",
    entities: "Entities",
    report: "Briefing",
    sources: "Sources",
    prompts: "Prompts",
    global: "General",
  };

  let query = $state("");
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => {
      const title = (conversation.title ?? "").toLowerCase();
      const snippet = (conversation.snippet ?? "").toLowerCase();
      return title.includes(needle) || snippet.includes(needle);
    });
  });

  function snippetOf(conversation: ConversationRow): string {
    const text = (conversation.snippet ?? "").replace(/\s+/g, " ").trim();
    return text.length > 100 ? `${text.slice(0, 100)}…` : text;
  }

  function startRename(conversation: ConversationRow) {
    renamingId = conversation.id;
    renameValue = conversation.title ?? "";
  }

  function cancelRename() {
    renamingId = null;
    renameValue = "";
  }

  function focusOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
</script>

<div class="flex flex-col gap-2 min-h-0 h-full">
  <button
    type="button"
    class="tap nav-btn border-primary-700 text-primary-300 hover:bg-surface-800 text-left shrink-0"
    onclick={() => onNewConversation?.()}
  >
    + New chat
  </button>

  {#if conversations.length > 4}
    <input
      type="search"
      placeholder="Search conversations…"
      bind:value={query}
      aria-label="Search conversations"
      class="input-base-flush w-full text-xs shrink-0"
    />
  {/if}

  <div class="flex flex-col gap-2 overflow-y-auto min-h-0">
    {#if filtered.length === 0}
      <p class="text-surface-400 text-xs px-1">
        {conversations.length === 0 ? "No conversations yet." : "Nothing matches."}
      </p>
    {/if}

    {#each filtered as conversation (conversation.id)}
      {@const active = conversation.id === activeId}
      <div
        class="rounded-lg border px-3 py-2 text-xs transition-colors {active
          ? 'bg-surface-800 border-surface-500'
          : 'bg-surface-950 border-surface-800 hover:bg-surface-900'}"
      >
        {#if renamingId === conversation.id}
          <form
            method="POST"
            action="?/rename"
            use:enhance={() => async ({ update }) => {
              cancelRename();
              await update();
            }}
            class="flex items-center gap-1.5"
          >
            <input type="hidden" name="id" value={conversation.id} />
            <input
              type="text"
              name="title"
              bind:value={renameValue}
              use:focusOnMount
              onkeydown={(event) => event.key === "Escape" && cancelRename()}
              class="input-base w-full text-xs py-1"
              aria-label="Conversation title"
            />
            <button type="submit" class="tap text-primary-400 hover:text-primary-300 shrink-0" title="Save" aria-label="Save title">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </button>
            <button type="button" onclick={cancelRename} class="tap text-surface-400 hover:text-surface-200 shrink-0" title="Cancel" aria-label="Cancel">
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </form>
        {:else}
          <a
            href="/chat?c={conversation.id}"
            onclick={() => onSelect?.()}
            class="block no-underline {active ? 'text-surface-100' : 'text-surface-300'}"
          >
            <span class="line-clamp-2 block font-medium">{conversation.title ?? "Untitled"}</span>
            {#if conversation.snippet}
              <span class="line-clamp-1 block text-surface-400 mt-0.5">{snippetOf(conversation)}</span>
            {/if}
            <span class="text-surface-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{fmtDateTimeShort(conversation.updated_at)}</span>
              {#if conversation.surface}
                <Badge tone="muted">{SURFACE_LABEL[conversation.surface] ?? conversation.surface}</Badge>
              {/if}
            </span>
          </a>
          <div class="mt-1.5 flex items-center justify-end gap-2">
            <button
              type="button"
              onclick={() => startRename(conversation)}
              title="Rename"
              aria-label="Rename conversation"
              class="tap text-surface-500 hover:text-surface-200"
            >
              <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete"
              action="?/delete"
              fields={{ id: conversation.id }}
              tone="error"
              icon
              onSuccess={() => {
                if (active) onDeletedActive?.();
              }}
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
