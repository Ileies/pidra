<script lang="ts">
  import type { UiToolCall } from "$lib/assistant/state.svelte";

  let { call }: { call: UiToolCall } = $props();

  // Plain language, because the point of the chip is that the user can see what happened without
  // knowing the skill registry.
  const LABELS: Record<string, string> = {
    list_notes: "Read notes",
    write_note: "Wrote a note",
    update_note: "Changed a note",
    delete_note: "Deleted a note",
    restore_note: "Restored a note",
    read_context: "Read the long-term context",
    revise_context: "Recorded a context correction",
    revert_context_revision: "Reverted a correction",
    read_report: "Read the briefing",
    add_todo_item: "Added a to-do",
    complete_todo_item: "Completed a to-do",
    add_calendar_event: "Added a calendar event",
    run_web_search: "Searched the web",
    set_source_active: "Toggled a source",
    propose_prompt_version: "Proposed a prompt version",
  };

  const label = $derived(LABELS[call.name] ?? call.name);
  const pending = $derived(!call.status);

  const statusClass = $derived(
    pending
      ? "text-surface-300 border-surface-700"
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
  <summary class="tap cursor-pointer flex items-center gap-2">
    <span>{label}</span>
    {#if pending}
      <span class="text-surface-400">running…</span>
    {:else if call.status !== "executed"}
      <span class="text-surface-400">{call.status}</span>
    {/if}
  </summary>

  <div class="mt-2 flex flex-col gap-1">
    <code class="text-surface-400">{call.name}</code>
    {#if Object.keys(call.arguments).length > 0}
      <pre class="text-surface-300 whitespace-pre-wrap break-words">{JSON.stringify(call.arguments, null, 2)}</pre>
    {/if}
    {#if call.message}
      <div class="text-surface-200 whitespace-pre-wrap break-words">{call.message}</div>
    {/if}
    {#if call.status === "pending_confirmation"}
      <a href="/skills" class="text-warning-400 hover:text-warning-300">Confirm on /skills →</a>
    {/if}
  </div>
</details>
