<script lang="ts">
  import { goto } from "$app/navigation";
  import type { PageData } from "./$types";
  import type { ChatToolCall } from "./+page.server";

  let { data }: { data: PageData } = $props();

  interface Message {
    id: string;
    role: string;
    content: string;
    tool_calls: ChatToolCall[] | null;
    created_at: string;
  }

  // Server data is the source of truth; the local list exists so the user's own message and a
  // "thinking" state appear immediately instead of after the round trip, which can be slow -
  // the chat runs on the flex service tier like every other model call in the system.
  let pending = $state<Message[]>([]);
  let draft = $state("");
  let sending = $state(false);
  let error = $state<string | null>(null);
  // Set only by the "new conversation" button. Otherwise the URL, via the load function, is the
  // single source of truth for which conversation is open.
  let composingNew = $state(false);

  const conversationId = $derived(composingNew ? null : data.activeId);
  const messages = $derived(composingNew ? pending : ([...data.messages, ...pending] as Message[]));

  $effect(() => {
    // Navigating to another conversation drops anything optimistic from this one.
    data.activeId;
    pending = [];
  });

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  function fmtTs(s: string): string {
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function statusClass(status: string | undefined): string {
    if (status === "executed") return "text-success-400 border-success-800";
    if (status === "failed" || status === "rejected") return "text-error-400 border-error-800";
    if (status === "pending_confirmation") return "text-warning-400 border-warning-800";
    return "text-surface-400 border-surface-700";
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    sending = true;
    error = null;
    draft = "";
    const stamp = new Date().toISOString();
    pending = [{ id: `local-${stamp}`, role: "user", content: text, tool_calls: null, created_at: stamp }];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversation_id: conversationId ?? undefined }),
      });
      const body = await res.json();

      if (!res.ok || body.error) {
        error = body.error ?? `Request failed (${res.status})`;
        draft = text;
        pending = [];
        return;
      }

      pending = [];
      composingNew = false;
      // Reload from Postgres so the transcript, the conversation list and the corrections
      // sidebar all reflect whatever the skills actually wrote.
      await goto(`/chat?c=${body.conversationId}`, { invalidateAll: true, noScroll: true });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      draft = text;
      pending = [];
    } finally {
      sending = false;
    }
  }

  // Nothing is created until the first message is sent.
  function newConversation() {
    composingNew = true;
    pending = [];
    error = null;
  }
</script>

<svelte:head>
  <title>PIDRA - Context Chat</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Context Chat</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/context-builder" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">Context Builder</a>
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 w-full max-w-6xl mx-auto px-6 py-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
    <!-- Conversations -->
    <aside class="flex flex-col gap-2 order-2 lg:order-1">
      <button
        class="{navBtn} border-primary-700 text-primary-400 hover:bg-surface-800 cursor-pointer text-left"
        onclick={newConversation}
      >
        + Neues Gespräch
      </button>
      {#each data.conversations as conversation}
        <a
          href="/chat?c={conversation.id}"
          class="px-3 py-2 rounded border text-xs no-underline transition-colors {conversation.id === conversationId
            ? 'bg-surface-800 border-surface-600 text-surface-100'
            : 'bg-surface-950 border-surface-800 text-surface-400 hover:bg-surface-900'}"
        >
          <div class="line-clamp-2">{conversation.title ?? "Ohne Titel"}</div>
          <div class="text-surface-600 mt-1">{fmtTs(conversation.updated_at)}</div>
        </a>
      {/each}
    </aside>

    <!-- Transcript -->
    <section class="flex flex-col gap-4 order-1 lg:order-2 min-w-0">
      {#if messages.length === 0}
        <div class="bg-surface-900 border border-surface-700 rounded-lg p-5 text-sm text-surface-400">
          <p class="text-surface-200 font-semibold mb-2">Kontext korrigieren</p>
          <p class="mb-2">
            Sag, was der Context Builder falsch verstanden hat. Nichts wird überschrieben: Korrekturen
            werden als eigene Schicht über die Analyse gelegt und schlagen sie im täglichen Briefing.
          </p>
          <p class="text-surface-500">
            Beispiel: „X ist meine Freundin, nicht nur eine Bekannte. Und Y ist meine Schwester, nicht
            meine Freundin."
          </p>
        </div>
      {/if}

      {#each messages as message (message.id)}
        <article
          class="rounded-lg px-4 py-3 border text-sm whitespace-pre-wrap break-words {message.role === 'user'
            ? 'bg-surface-800 border-surface-700 text-surface-100 lg:ml-12'
            : 'bg-surface-900 border-surface-800 text-surface-200 lg:mr-12'}"
        >
          <div class="text-surface-600 text-xs mb-1">
            {message.role === "user" ? "Du" : "PIDRA"} · {fmtTs(message.created_at)}
          </div>
          {message.content}

          {#if message.tool_calls && message.tool_calls.length > 0}
            <div class="mt-3 flex flex-col gap-2">
              {#each message.tool_calls as call}
                <details class="rounded border bg-surface-950 px-3 py-2 text-xs {statusClass(call.status)}">
                  <summary class="cursor-pointer">
                    <code>{call.name}</code> · {call.status ?? "executed"}
                  </summary>
                  <pre class="mt-2 text-surface-400 whitespace-pre-wrap break-words">{JSON.stringify(call.arguments, null, 2)}</pre>
                  {#if call.result}
                    <div class="mt-2 text-surface-300 whitespace-pre-wrap break-words">{call.result}</div>
                  {/if}
                </details>
              {/each}
            </div>
          {/if}
        </article>
      {/each}

      {#if sending}
        <div class="text-surface-500 text-xs px-4">PIDRA denkt nach… (flex tier, das kann dauern)</div>
      {/if}

      {#if error}
        <div class="rounded-lg border border-error-800 bg-surface-900 px-4 py-3 text-sm text-error-400">{error}</div>
      {/if}

      <form onsubmit={send} class="sticky bottom-0 bg-surface-950 pt-2 flex gap-2">
        <textarea
          bind:value={draft}
          rows="3"
          placeholder={composingNew ? "Neues Gespräch beginnen…" : "Nachricht…"}
          disabled={sending}
          class="flex-1 px-3 py-2 rounded text-sm bg-surface-900 border border-surface-700 text-surface-100 placeholder-surface-600 focus:outline-none focus:border-surface-500 resize-y disabled:opacity-50"
        ></textarea>
        <button
          type="submit"
          disabled={sending || draft.trim() === ""}
          class="px-4 py-2 rounded text-sm bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-end"
        >
          {sending ? "…" : "Senden"}
        </button>
      </form>
    </section>

    <!-- Active corrections -->
    <aside class="order-3 flex flex-col gap-2 min-w-0">
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
