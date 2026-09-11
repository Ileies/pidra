<script lang="ts">
  import { enhance } from "$app/forms";
  import { setPageContext } from "$lib/assistant/state.svelte";
  import type { PageData, ActionData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The assistant may propose a version here, never activate one: prompt changes require human
  // approval, and activation lives on this page.
  $effect(() => {
    setPageContext({
      surface: "prompts",
      route: "/prompts",
      digest: `Prompt-Verwaltung: ${data.sections.length} Sections. ${data.sections
        .map((section) => `${section.section}: ${section.versions.length} Version(en)`)
        .join(", ")}.`,
      focus: data.sections.map((section) => ({ kind: "section", id: section.section })),
    });
  });

  function fmtDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleString("de-DE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
</script>

<svelte:head>
  <title>PIDRA - Prompts</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0">
  <main class="flex-1 max-w-4xl w-full mx-auto px-8 py-6 pb-16">
    {#if form?.error}
      <p class="text-error-400 text-sm mb-4">{form.error}</p>
    {/if}

    <p class="text-xs text-surface-500 mb-6">
      Jede Sektion läuft auf der aktiven Version aus der Datenbank. Gibt es keine, greift der
      Prompt aus dem Code. Aktivieren wirkt ab dem nächsten Pipeline-Lauf, ohne Deploy.
    </p>

    {#if data.sections.length === 0}
      <p class="text-surface-400 text-sm text-center py-16">Bridge nicht erreichbar.</p>
    {:else}
      <div class="flex flex-col gap-8">
        {#each data.sections as group (group.section)}
          <div>
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <h2 class="font-mono text-sm font-semibold text-surface-300 uppercase tracking-wider">{group.section}</h2>
              {#if !group.effective}
                <span class="badge text-xs border text-warning-400 bg-warning-950 border-warning-700">wird nicht gelesen</span>
              {:else if group.effective.source === "db"}
                <span class="badge text-xs border text-success-400 bg-success-950 border-success-700">läuft auf v{group.effective.version}</span>
              {:else}
                <span class="badge text-xs border text-surface-400 bg-surface-900 border-surface-700">läuft auf Code-Prompt</span>
              {/if}
            </div>

            <div class="flex flex-col gap-3">
              {#if group.effective?.source === "code"}
                <div class="bg-surface-900 border border-surface-700 rounded-lg px-5 py-4">
                  <div class="flex flex-wrap items-center gap-2 mb-3">
                    <span class="font-mono text-xs text-surface-400">Code</span>
                    <span class="badge text-xs border text-surface-300 bg-surface-800 border-surface-600">in Benutzung</span>
                    <span class="text-xs text-surface-500 italic">src/ai/prompts.ts - nur per Deploy änderbar</span>
                  </div>
                  <pre class="text-xs text-surface-300 bg-surface-950 rounded px-3 py-2 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{group.effective.text}</pre>
                </div>
              {/if}

              {#each group.versions as prompt (prompt.id)}
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
