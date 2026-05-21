<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  const SCOPE_CLASS: Record<string, string> = {
    global: "text-primary-400 bg-primary-950 border-primary-700",
    intel: "text-warning-400 bg-warning-950 border-warning-700",
    personal: "text-success-400 bg-success-950 border-success-700",
    contact: "text-surface-300 bg-surface-800 border-surface-600",
    search: "text-surface-400 bg-surface-900 border-surface-700",
  };

  const SCOPES = ["global", "intel", "personal", "contact", "search"];

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  let adding = false;
</script>

<svelte:head>
  <title>PIDRA - Notes</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Notes</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 max-w-3xl w-full mx-auto px-8 py-6 pb-16">
    <div class="flex flex-wrap gap-3 mb-6">
      <form method="GET" class="flex gap-2 flex-wrap">
        <select name="scope" class="px-3 py-1.5 rounded text-sm bg-surface-900 border border-surface-700 text-surface-200 focus:outline-none focus:border-surface-500">
          <option value="" selected={data.scopeFilter === ""}>Alle Scopes</option>
          {#each SCOPES as s}
            <option value={s} selected={data.scopeFilter === s}>{s}</option>
          {/each}
        </select>
        <button type="submit" class="px-3 py-1.5 rounded text-sm bg-surface-800 border border-surface-600 text-surface-200 hover:bg-surface-700 cursor-pointer">Filter</button>
      </form>

      <button
        on:click={() => (adding = !adding)}
        class="ml-auto px-3 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer transition-colors"
      >
        {adding ? "Abbrechen" : "+ Neue Note"}
      </button>
    </div>

    {#if adding}
      <form
        method="POST"
        action="?/add"
        use:enhance={() => {
          return async ({ update }) => {
            await update({ reset: true });
            adding = false;
          };
        }}
        class="bg-surface-900 border border-surface-700 rounded-lg px-5 py-4 mb-6 flex flex-col gap-3"
      >
        <textarea
          name="content"
          rows="3"
          placeholder="Note content…"
          required
          class="w-full px-3 py-2 rounded text-sm bg-surface-950 border border-surface-700 text-surface-100 placeholder-surface-600 focus:outline-none focus:border-surface-500 resize-y"
        ></textarea>
        <div class="flex items-center gap-3">
          <select name="scope" class="px-3 py-1.5 rounded text-sm bg-surface-950 border border-surface-700 text-surface-200 focus:outline-none focus:border-surface-500">
            {#each SCOPES as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
          <button type="submit" class="px-4 py-1.5 rounded text-sm bg-primary-900 border border-primary-700 text-primary-300 hover:bg-primary-800 cursor-pointer transition-colors">
            Hinzufügen
          </button>
          {#if form?.error}
            <span class="text-error-400 text-xs">{form.error}</span>
          {/if}
        </div>
      </form>
    {/if}

    {#if data.notes.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">Keine Notes gefunden.</p>
    {:else}
      <div class="text-xs text-surface-600 mb-3">{data.notes.length} Einträge</div>
      <div class="flex flex-col gap-3">
        {#each data.notes as note}
          <div class="bg-surface-900 border border-surface-700 rounded-lg px-5 py-4">
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-surface-100 whitespace-pre-wrap break-words">{note.content}</p>
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                  <span class="badge text-xs border {SCOPE_CLASS[note.scope] ?? 'text-surface-500 bg-surface-900 border-surface-700'}">{note.scope}</span>
                  {#if note.created_by}
                    <span class="text-xs text-surface-600">{note.created_by}</span>
                  {/if}
                  <span class="text-xs text-surface-600 ml-auto">{fmtDate(note.created_at)}</span>
                  {#if note.expires_at}
                    <span class="text-xs text-surface-600">· läuft ab {note.expires_at}</span>
                  {/if}
                </div>
              </div>
              {#if note.created_by === "user"}
                <form
                  method="POST"
                  action="?/delete"
                  use:enhance={() => ({ update }) => update({ reset: false })}
                >
                  <input type="hidden" name="id" value={note.id} />
                  <button
                    type="submit"
                    class="text-surface-600 hover:text-error-400 transition-colors text-xs cursor-pointer bg-transparent border-none px-1 py-0.5 shrink-0"
                    aria-label="Delete"
                  >✕</button>
                </form>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>
