<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { UiToolCall } from "#lib/assistant/state.svelte.js";
  import Badge from "#lib/components/Badge.svelte";
  import Spinner from "#lib/components/Spinner.svelte";
  import { label } from "#lib/labels.js";
  import { ICON } from "#lib/routes.js";

  let { call }: { call: UiToolCall } = $props();

  const TODO = "M5 6l1.3 1.3L9 4.6M5 12l1.3 1.3L9 10.6M5 18l1.3 1.3L9 16.6M12 6h7M12 12h7M12 18h7";
  const CALENDAR = "M7 3v3M17 3v3M4 8h16M5 5h14v14H5zM8 13h3M13 13h3M8 17h3";
  const SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3";
  const PROMPT = "M4 5h16v11H9l-5 4zM8 9h8M8 12.5h5";
  const MAIL = "M4 5h16v14H4zM4 6l8 7 8-7";
  const FILE = "M6 3h9l5 5v13H6zM15 3v5h5";
  const EXTERNAL = "M9 15L20 4M14 4h6v6M6 9v11h11v-5";

  // Plain language, because the point of the chip is that the user can see what happened without
  // knowing the skill registry.
  const SKILLS: Record<string, { label: string; icon: string }> = {
    list_notes: { label: "Read notes", icon: ICON.notes },
    write_note: { label: "Wrote a note", icon: ICON.notes },
    update_note: { label: "Changed a note", icon: ICON.notes },
    delete_note: { label: "Deleted a note", icon: ICON.notes },
    restore_note: { label: "Restored a note", icon: ICON.notes },
    read_context: { label: "Read the long-term context", icon: ICON.context },
    revise_context: { label: "Recorded a context correction", icon: ICON.context },
    revert_context_revision: { label: "Reverted a correction", icon: ICON.context },
    remove_context_item: { label: "Removed a context item", icon: ICON.context },
    add_contact: { label: "Added a contact", icon: ICON.context },
    list_questions: { label: "Read the open questions", icon: ICON.questions },
    create_question: { label: "Asked you a question", icon: ICON.questions },
    read_report: { label: "Read the briefing", icon: ICON.report },
    add_todo_item: { label: "Added a to-do", icon: TODO },
    complete_todo_item: { label: "Completed a to-do", icon: TODO },
    list_todo_items: { label: "Read the to-dos", icon: TODO },
    update_todo_item: { label: "Changed a to-do", icon: TODO },
    delete_todo_item: { label: "Deleted a to-do", icon: TODO },
    add_calendar_event: { label: "Added a calendar event", icon: CALENDAR },
    update_calendar_event: { label: "Changed a calendar event", icon: CALENDAR },
    delete_calendar_event: { label: "Deleted a calendar event", icon: CALENDAR },
    list_calendar_events: { label: "Read the calendar", icon: CALENDAR },
    get_calendar_event: { label: "Read a calendar event", icon: CALENDAR },
    run_web_search: { label: "Searched the web", icon: SEARCH },
    set_source_active: { label: "Toggled a source", icon: ICON.sources },
    propose_prompt_version: { label: "Proposed a prompt version", icon: PROMPT },
    create_file: { label: "Created a file", icon: FILE },
    send_email: { label: "Sent an email", icon: MAIL },
    send_mail: { label: "Sent mail", icon: MAIL },
    open_project_in_editor: { label: "Opened the project", icon: EXTERNAL },
  };

  /** One `name: value` line per argument: no braces or quotes around a payload meant to be read. */
  function formatArguments(args: Record<string, unknown>): string {
    return Object.entries(args)
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n");
  }

  const skill = $derived(SKILLS[call.name]);
  const chipLabel = $derived(skill?.label ?? call.name);
  const iconPath = $derived(skill?.icon ?? ICON.skills);
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
    class="tap list-none flex items-center gap-2 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden"
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
    <ChevronRight class="h-3 w-3 shrink-0 text-surface-500 transition-transform group-open:rotate-90" />
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
