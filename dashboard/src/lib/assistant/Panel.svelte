<script lang="ts">
  import { assistant, type UiMessage } from "#lib/assistant/state.svelte.js";
  import ToolChip from "#lib/assistant/ToolChip.svelte";
  import EmptyState from "#lib/components/EmptyState.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { renderMarkdown } from "#lib/markdown.js";
  import { fmtTime } from "#lib/format.js";

  interface Props {
    /** The widget hides its own transcript scroller inside a fixed panel; /chat does not. */
    variant?: "widget" | "page";
  }

  let { variant = "widget" }: Props = $props();

  let composer = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let copiedId = $state<string | null>(null);

  const hints = $derived(assistant.info?.hints ?? []);
  const notice = $derived(assistant.info?.notice ?? null);

  // The chat-bubble mark used as the assistant's avatar, lifted from the launcher button so the
  // two read as one identity.
  const ASSISTANT_MARK =
    "M21 11.5a8.4 8.4 0 0 1-9 8.3 9 9 0 0 1-2.8-.4L3 21l1.6-4.8A8.2 8.2 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.3 8.4 8.4 0 0 1 8.4 8.3z";

  // Stick to the bottom while a turn streams in.
  $effect(() => {
    assistant.messages;
    assistant.streaming;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  // The panel is mounted when it opens, so this is the "focus on open" behaviour.
  $effect(() => {
    composer?.focus();
  });

  // Auto-grow the composer with its content instead of a fixed two rows, capped so a pasted
  // paragraph scrolls inside the box rather than pushing the transcript off screen.
  const MAX_COMPOSER_HEIGHT = 160;
  $effect(() => {
    assistant.draft;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    assistant.send(assistant.draft);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      assistant.send(assistant.draft);
    }
  }

  /** Before the first token of a round, the model is between "got the message" and "said
   *  something" - a distinct wait from a tool actually running, worth naming differently. */
  function phaseLabel(message: UiMessage): string {
    if (message.toolCalls.length === 0) return "Thinking…";
    const last = message.toolCalls[message.toolCalls.length - 1];
    return last.status ? "Writing a reply…" : "Using a skill…";
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedId = id;
      setTimeout(() => {
        if (copiedId === id) copiedId = null;
      }, 1500);
    } catch {
      // No clipboard permission: the button just does nothing rather than erroring the turn.
    }
  }
</script>

<div class="flex flex-col min-h-0 {variant === 'widget' ? 'flex-1' : ''}">
  <div
    bind:this={scroller}
    aria-live="polite"
    class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-3 py-3 sm:px-4"
  >
    {#if assistant.messages.length === 0}
      <EmptyState title={assistant.info?.label ?? "Assistant"}>
        {#if notice}
          <p class="text-warning-400 text-xs">{notice}</p>
        {/if}
        {#if hints.length > 0}
          <div class="flex flex-col gap-1.5 w-full max-w-sm text-left">
            <p class="text-xs text-surface-400">On this page, for example:</p>
            {#each hints as hint (hint)}
              <button
                onclick={() => assistant.setDraft(hint)}
                class="tap text-left text-xs rounded-lg border border-surface-800 bg-surface-950 px-3 py-2 text-surface-300 hover:bg-surface-900 hover:text-surface-100 cursor-pointer transition-colors"
              >{hint}</button>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-surface-400">Say what should change.</p>
        {/if}
      </EmptyState>
    {/if}

    {#each assistant.messages as message, index (message.id)}
      {@const mine = message.role === "user"}
      {@const showLabel = index === 0 || assistant.messages[index - 1].role !== message.role}
      <div class="flex items-end gap-2 {mine ? 'justify-end' : 'justify-start'}">
        {#if !mine}
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-950 border border-primary-800 self-start"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-primary-400" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d={ASSISTANT_MARK} />
            </svg>
          </span>
        {/if}

        <div class="flex flex-col gap-1 min-w-0 {mine ? 'items-end' : 'items-start'} max-w-[88%] sm:max-w-[80%]">
          {#if showLabel}
            <div class="flex items-center gap-1.5 text-[10px] text-surface-500 px-1">
              <span>{mine ? "You" : "PIDRA"}</span>
              {#if message.createdAt}<span>· {fmtTime(message.createdAt, false)}</span>{/if}
            </div>
          {/if}

          <article
            class="group/msg relative rounded-2xl px-3 py-2 text-sm break-words border min-w-0
              {mine
                ? 'bg-primary-900 border-primary-800 text-primary-100 rounded-br-sm'
                : 'bg-surface-900 border-surface-800 text-surface-200 rounded-bl-sm'}"
          >
            {#if message.content}
              {#if mine}
                <p class="whitespace-pre-wrap">{message.content}</p>
              {:else}
                <div class="report-body chat-body text-sm">{@html renderMarkdown(message.content)}</div>
                <button
                  type="button"
                  onclick={() => copy(message.id, message.content)}
                  title="Copy reply"
                  aria-label="Copy reply"
                  class="tap absolute -top-2 -right-2 h-6 w-6 flex items-center justify-center rounded-full border border-surface-700 bg-surface-950 text-surface-400 opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 hover:text-surface-100 cursor-pointer transition-opacity"
                >
                  {#if copiedId === message.id}
                    <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  {/if}
                </button>
              {/if}
            {:else if message.role === "assistant" && assistant.streaming}
              <div class="flex items-center gap-2 text-surface-400 text-xs py-0.5">
                <Spinner size="sm" label={phaseLabel(message)} />
                <span>{phaseLabel(message)}</span>
              </div>
            {/if}
          </article>

          {#if message.toolCalls.length > 0}
            <div class="flex flex-col gap-1.5 w-full">
              {#each message.toolCalls as call, callIndex (`${message.id}-${callIndex}`)}
                <ToolChip {call} />
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}

    {#if assistant.error}
      <div class="rounded-lg border border-error-800 bg-surface-900 px-3 py-2 text-xs text-error-400">
        {assistant.error}
      </div>
    {/if}
  </div>

  <form onsubmit={submit} class="border-t border-surface-800 px-3 py-2 flex flex-col gap-1.5 bg-surface-950">
    <textarea
      bind:this={composer}
      value={assistant.draft}
      oninput={(event) => assistant.setDraft(event.currentTarget.value)}
      onkeydown={onKeydown}
      rows="1"
      placeholder={assistant.conversationId ? "Message…" : "What should change?"}
      disabled={assistant.streaming}
      aria-label="Message"
      class="input-base w-full resize-none disabled:opacity-50 overflow-y-auto"
      style="max-height: {MAX_COMPOSER_HEIGHT}px"
    ></textarea>
    <div class="flex items-center gap-2 pb-[var(--safe-b)] xl:pb-0">
      <button
        type="button"
        onclick={() => assistant.newConversation()}
        disabled={assistant.streaming || assistant.messages.length === 0}
        class="tap px-3 py-1 rounded text-xs bg-surface-900 border border-surface-500 text-surface-300 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >New chat</button>
      <span class="text-[10px] text-surface-500 hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
      {#if assistant.streaming}
        <button
          type="button"
          onclick={() => assistant.cancel()}
          class="tap ml-auto px-4 py-1 rounded text-xs bg-surface-900 border border-surface-500 text-surface-200 hover:bg-surface-800 cursor-pointer"
        >Stop</button>
      {:else}
        <button
          type="submit"
          disabled={assistant.draft.trim() === ""}
          class="tap ml-auto px-4 py-1 rounded text-xs bg-primary-900 border border-primary-700 text-primary-200 hover:bg-primary-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >Send</button>
      {/if}
    </div>
  </form>
</div>
