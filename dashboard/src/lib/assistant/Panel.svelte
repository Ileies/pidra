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
        <p class="text-surface-200 font-semibold">{assistant.info?.label ?? "Assistent"}</p>
        {#if notice}
          <p class="text-warning-400 text-xs">{notice}</p>
        {/if}
        {#if hints.length > 0}
          <p class="text-xs text-surface-500">Auf dieser Seite zum Beispiel:</p>
          <div class="flex flex-col gap-1">
            {#each hints as hint}
              <button
                onclick={() => assistant.setDraft(hint)}
                class="text-left text-xs rounded border border-surface-800 bg-surface-950 px-3 py-2 text-surface-300 hover:bg-surface-900 hover:text-surface-100 cursor-pointer transition-colors"
              >{hint}</button>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-surface-500">Sag, was geändert werden soll.</p>
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
          <span class="text-surface-500 text-xs">PIDRA arbeitet… (flex tier, das kann dauern)</span>
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
      placeholder={assistant.conversationId ? "Nachricht…" : "Was soll geändert werden?"}
      disabled={assistant.streaming}
      class="w-full px-3 py-2 rounded text-sm bg-surface-900 border border-surface-700 text-surface-100 placeholder-surface-600 focus:outline-none focus:border-surface-500 resize-none disabled:opacity-50"
    ></textarea>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => assistant.newConversation()}
        disabled={assistant.streaming || assistant.messages.length === 0}
        class="px-2 py-1 rounded text-xs bg-surface-900 border border-surface-700 text-surface-400 hover:bg-surface-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >Neuer Chat</button>
      {#if assistant.streaming}
        <button
          type="button"
          onclick={() => assistant.cancel()}
          class="ml-auto px-3 py-1 rounded text-xs bg-surface-900 border border-surface-600 text-surface-300 hover:bg-surface-800 cursor-pointer"
        >Stopp</button>
      {:else}
        <button
          type="submit"
          disabled={assistant.draft.trim() === ""}
          class="ml-auto px-3 py-1 rounded text-xs bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >Senden</button>
      {/if}
    </div>
  </form>
</div>
