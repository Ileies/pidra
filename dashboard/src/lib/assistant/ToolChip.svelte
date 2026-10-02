<script lang="ts">
  import type { UiToolCall } from "#lib/assistant/state.svelte.js";
  import Badge from "#lib/components/Badge.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { label } from "#lib/labels.js";

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
    remove_context_item: "Removed a context item",
    add_contact: "Added a contact",
    list_questions: "Read the open questions",
    create_question: "Asked you a question",
    read_report: "Read the briefing",
    add_todo_item: "Added a to-do",
    complete_todo_item: "Completed a to-do",
    add_calendar_event: "Added a calendar event",
    update_calendar_event: "Changed a calendar event",
    run_web_search: "Searched the web",
    set_source_active: "Toggled a source",
    propose_prompt_version: "Proposed a prompt version",
    create_file: "Created a file",
    send_email: "Sent an email",
    send_mail: "Sent mail",
    open_project_in_editor: "Opened the project",
  };

  // 24x24 stroke paths, matching the hand-authored icon set in $lib/routes.ts - a small local set
  // rather than exporting that one, since these are keyed by skill name, not by route.
  const NOTE = "M6 3h9l5 5v13H6zM15 3v5h5M9 13h7M9 17h5";
  const CONTEXT = "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5";
  const REPORT = "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5";
  const TODO = "M5 6l1.3 1.3L9 4.6M5 12l1.3 1.3L9 10.6M5 18l1.3 1.3L9 16.6M12 6h7M12 12h7M12 18h7";
  const CALENDAR = "M7 3v3M17 3v3M4 8h16M5 5h14v14H5zM8 13h3M13 13h3M8 17h3";
  const SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3";
  const SOURCE = "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3";
  const PROMPT = "M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5";
  const MAIL = "M4 5h16v14H4zM4 6l8 7 8-7";
  const FILE = "M6 3h9l5 5v13H6zM15 3v5h5";
  const EXTERNAL = "M9 15L20 4M14 4h6v6M6 9v11h11v-5";
  const QUESTION = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.7-.8 1.2v.4M12 17h.01";
  const WRENCH = "M14.7 6.3a4 4 0 1 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-2.4-.6-.6-2.4z";

  const ICON_PATHS: Record<string, string> = {
    list_notes: NOTE,
    write_note: NOTE,
    update_note: NOTE,
    delete_note: NOTE,
    restore_note: NOTE,
    read_context: CONTEXT,
    revise_context: CONTEXT,
    revert_context_revision: CONTEXT,
    remove_context_item: CONTEXT,
    add_contact: CONTEXT,
    list_questions: QUESTION,
    create_question: QUESTION,
    read_report: REPORT,
    add_todo_item: TODO,
    complete_todo_item: TODO,
    add_calendar_event: CALENDAR,
    update_calendar_event: CALENDAR,
    run_web_search: SEARCH,
    set_source_active: SOURCE,
    propose_prompt_version: PROMPT,
    send_email: MAIL,
    send_mail: MAIL,
    create_file: FILE,
    open_project_in_editor: EXTERNAL,
  };

  /** One `name: value` line per argument: no braces or quotes around a payload meant to be read. */
  function formatArguments(args: Record<string, unknown>): string {
    return Object.entries(args)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n");
  }

  const chipLabel = $derived(LABELS[call.name] ?? call.name);
  const iconPath = $derived(ICON_PATHS[call.name] ?? WRENCH);
  const pending = $derived(!call.status);

  const TONE = {
    executed: "success",
    rejected: "warning",
    pending_confirmation: "warning",
    failed: "error",
    unknown_skill: "error",
  } as const;
  const tone = $derived(call.status ? (TONE[call.status as keyof typeof TONE] ?? "neutral") : "neutral");

  const ICON_TONE = {
    neutral: "border-surface-700 text-surface-300",
    success: "border-success-800 text-success-400",
    warning: "border-warning-800 text-warning-400",
    error: "border-error-800 text-error-400",
  } as const;
</script>

<details class="group rounded-lg border border-surface-800 bg-surface-950 overflow-hidden">
  <summary
    class="tap cursor-pointer list-none flex items-center gap-2 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden"
  >
    <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border {ICON_TONE[tone]}">
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d={iconPath} />
      </svg>
    </span>
    <span class="text-xs text-surface-200 flex-1 min-w-0 truncate">{chipLabel}</span>
    {#if pending}
      <Spinner size="sm" label="Running" />
    {:else}
      <Badge {tone}>{label(call.status)}</Badge>
    {/if}
    <svg viewBox="0 0 24 24" class="h-3 w-3 shrink-0 text-surface-500 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  </summary>

  <div class="px-2.5 pb-2 ml-8 flex flex-col gap-1 text-xs border-t border-surface-900 pt-2">
    <code class="text-surface-400">{call.name}</code>
    {#if Object.keys(call.arguments).length > 0}
      <pre class="text-surface-300 whitespace-pre-wrap break-words">{formatArguments(call.arguments)}</pre>
    {/if}
    {#if call.message}
      <div class="text-surface-200 whitespace-pre-wrap break-words">{call.message}</div>
    {/if}
    {#if call.status === "pending_confirmation"}
      <a href="/skills" class="text-warning-400 hover:text-warning-300">Confirm on /skills →</a>
    {/if}
  </div>
</details>
