<script lang="ts">
  import type { UiToolCall } from "$lib/assistant/state.svelte";

  let { call }: { call: UiToolCall } = $props();

  // Plain language, because the point of the chip is that the user can see what happened without
  // knowing the skill registry.
  const LABELS: Record<string, string> = {
    list_notes: "Notes gelesen",
    write_note: "Note geschrieben",
    update_note: "Note geändert",
    delete_note: "Note gelöscht",
    restore_note: "Note wiederhergestellt",
    read_context: "Kontext gelesen",
    revise_context: "Kontext korrigiert",
    revert_context_revision: "Korrektur zurückgenommen",
    read_report: "Briefing gelesen",
    add_todo_item: "Todo angelegt",
    complete_todo_item: "Todo abgeschlossen",
    add_calendar_event: "Termin angelegt",
    run_web_search: "Web durchsucht",
    set_source_active: "Quelle umgeschaltet",
    propose_prompt_version: "Prompt-Version vorgeschlagen",
  };

  const label = $derived(LABELS[call.name] ?? call.name);
  const pending = $derived(!call.status);

  const statusClass = $derived(
    pending
      ? "text-surface-400 border-surface-700"
      : call.status === "executed"
        ? "text-success-400 border-success-800"
        : call.status === "rejected"
          ? "text-warning-400 border-warning-800"
          : call.status === "pending_confirmation"
            ? "text-warning-400 border-warning-800"
            : "text-error-400 border-error-800",
  );
</script>

<details class="rounded border bg-surface-950 px-3 py-1.5 text-xs {statusClass}">
  <summary class="cursor-pointer flex items-center gap-2">
    <span>{label}</span>
    {#if pending}
      <span class="text-surface-600">läuft…</span>
    {:else if call.status !== "executed"}
      <span class="text-surface-500">{call.status}</span>
    {/if}
  </summary>

  <div class="mt-2 flex flex-col gap-1">
    <code class="text-surface-600">{call.name}</code>
    {#if Object.keys(call.arguments).length > 0}
      <pre class="text-surface-400 whitespace-pre-wrap break-words">{JSON.stringify(call.arguments, null, 2)}</pre>
    {/if}
    {#if call.message}
      <div class="text-surface-300 whitespace-pre-wrap break-words">{call.message}</div>
    {/if}
    {#if call.status === "pending_confirmation"}
      <a href="/skills" class="text-warning-400 hover:text-warning-300">Auf /skills bestätigen →</a>
    {/if}
  </div>
</details>
