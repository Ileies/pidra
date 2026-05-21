<script lang="ts">
  import { enhance } from "$app/forms";
  import type { PageData, ActionData } from "./$types";

  export let data: PageData;
  export let form: ActionData;

  const navBtn = "px-3 py-1 rounded text-xs bg-surface-950 border transition-colors no-underline";

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const sectionOrder = ["section1", "section2", "extraction", "entity_extraction", "personal_classification"];

  $: sections = Object.entries(data.sections).sort(([a], [b]) => {
    const ai = sectionOrder.indexOf(a);
    const bi = sectionOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
</script>

<svelte:head>
  <title>PIDRA - Prompts</title>
</svelte:head>

<div class="flex flex-col min-h-screen">
  <header class="flex items-center justify-between px-8 py-3 bg-surface-900 border-b border-surface-700 sticky top-0 z-10">
    <div class="flex items-baseline gap-4">
      <span class="font-bold tracking-widest text-surface-50">PIDRA</span>
      <span class="text-surface-500 text-sm">Prompt Versions</span>
    </div>
    <nav class="flex items-center gap-2">
      <a href="/" class="{navBtn} border-surface-700 text-surface-200 hover:bg-surface-800">← Heute</a>
    </nav>
  </header>

  <main class="flex-1 max-w-4xl w-full mx-auto px-8 py-6 pb-16">
    {#if form?.error}
      <p class="text-error-400 text-sm mb-4">{form.error}</p>
    {/if}

    {#if sections.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">No prompt versions in the database yet.</p>
    {:else}
      <div class="flex flex-col gap-8">
        {#each sections as [section, versions]}
          <div>
            <h2 class="font-mono text-sm font-semibold text-surface-300 mb-3 uppercase tracking-wider">{section}</h2>
            <div class="flex flex-col gap-3">
              {#each versions as prompt}
                <div class="bg-surface-900 border {prompt.active ? 'border-success-700' : 'border-surface-700'} rounded-lg px-5 py-4">
                  <div class="flex flex-wrap items-center gap-2 mb-3">
                    <span class="font-mono text-xs text-surface-400">v{prompt.version}</span>
                    {#if prompt.active}
                      <span class="badge text-xs border text-success-400 bg-success-950 border-success-700">active</span>
                    {:else}
                      <span class="badge text-xs border text-surface-500 bg-surface-900 border-surface-700">inactive</span>
                    {/if}
                    {#if prompt.changeSummary}
                      <span class="text-xs text-surface-400 italic">{prompt.changeSummary}</span>
                    {/if}
                    <span class="text-xs text-surface-600 ml-auto">{fmtDate(prompt.createdAt)}</span>
                    {#if prompt.approvedAt}
                      <span class="text-xs text-surface-600">· approved {fmtDate(prompt.approvedAt)}</span>
                    {/if}
                  </div>

                  <pre class="text-xs text-surface-300 bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto mb-3">{prompt.promptText}</pre>

                  <div class="flex gap-2">
                    {#if !prompt.active}
                      <form method="POST" action="?/approve" use:enhance={() => ({ update }) => update({ reset: false })}>
                        <input type="hidden" name="id" value={prompt.id} />
                        <button type="submit" class="px-3 py-1 rounded text-xs bg-success-900 border border-success-700 text-success-300 hover:bg-success-800 cursor-pointer transition-colors">
                          Aktivieren
                        </button>
                      </form>
                      <form method="POST" action="?/delete" use:enhance={() => ({ update }) => update({ reset: false })}>
                        <input type="hidden" name="id" value={prompt.id} />
                        <button type="submit" class="px-3 py-1 rounded text-xs bg-surface-800 border border-surface-700 text-surface-400 hover:text-error-400 hover:border-error-700 cursor-pointer transition-colors">
                          Löschen
                        </button>
                      </form>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>
