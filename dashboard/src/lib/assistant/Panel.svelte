<script lang="ts">
  import { assistant } from "$lib/assistant/state.svelte";
  import ToolChip from "$lib/assistant/ToolChip.svelte";

  interface Props {
    /** The widget hides its own transcript scroller inside a fixed panel; /chat does not. */
    variant?: "widget" | "page";
  }

  let { variant = "widget" }: Props = $props();

  let composer = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);

  const hints = $derived(assistant.info?.hints ?? []);
  const notice = $derived(assistant.info?.notice ?? null);

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
</script>

<div class="flex flex-col min-h-0 {variant === 'widget' ? 'flex-1' : ''}">
  <div
    bind:this={scroller}
    aria-live="polite"
    class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-4 py-3"
  >
    {#if assistant.messages.length === 0}
      <div class="text-sm text-surface-400 flex flex-col gap-2">
        <p class="text-surface-200 font-semibold">{assistant.info?.label ?? "Assistant"}</p>
        {#if notice}
          <p class="text-warning-400 text-xs">{notice}</p>
        {/if}
        {#if hints.length > 0}
          <p class="text-xs text-surface-400">On this page, for example:</p>
          <div class="flex flex-col gap-1">
            {#each hints as hint (hint)}
              <button
                onclick={() => assistant.setDraft(hint)}
                class="tap text-left text-xs rounded border border-surface-800 bg-surface-950 px-3 py-2 text-surface-300 hover:bg-surface-900 hover:text-surface-100 cursor-pointer transition-colors"
              >{hint}</button>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-surface-400">Say what should change.</p>
        {/if}
      </div>
    {/if}

    {#each assistant.messages as message (message.id)}
      <article
        class="rounded-lg px-3 py-2 border text-sm whitespace-pre-wrap break-words {message.role === 'user'
          ? 'bg-surface-800 border-surface-700 text-surface-100 ml-6'
          : 'bg-surface-900 border-surface-800 text-surface-200 mr-6'}"
      >
        {#if message.content}
          {message.content}
        {:else if message.role === "assistant" && assistant.streaming}
          <span class="text-surface-400 text-xs">PIDRA is working… (flex tier, this can take a while)</span>
        {/if}

        {#if message.toolCalls.length > 0}
          <div class="mt-2 flex flex-col gap-1.5">
            {#each message.toolCalls as call, index (`${message.id}-${index}`)}
              <ToolChip {call} />
            {/each}
          </div>
        {/if}
      </article>
    {/each}

    {#if assistant.error}
      <div class="rounded-lg border border-error-800 bg-surface-900 px-3 py-2 text-xs text-error-400">
        {assistant.error}
      </div>
    {/if}
  </div>

  <form onsubmit={submit} class="border-t border-surface-800 px-3 py-2 flex flex-col gap-2 bg-surface-950">
    <textarea
      bind:this={composer}
      value={assistant.draft}
      oninput={(event) => assistant.setDraft(event.currentTarget.value)}
      onkeydown={onKeydown}
      rows="2"
      placeholder={assistant.conversationId ? "Message…" : "What should change?"}
      disabled={assistant.streaming}
      aria-label="Message"
      class="input-base w-full resize-none disabled:opacity-50"
    ></textarea>
    <div class="flex items-center gap-2 pb-[var(--safe-b)] sm:pb-0">
      <button
        type="button"
        onclick={() => assistant.newConversation()}
        disabled={assistant.streaming || assistant.messages.length === 0}
        class="tap px-3 py-1 rounded text-xs bg-surface-900 border border-surface-500 text-surface-300 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >New chat</button>
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
