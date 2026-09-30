import type { SkillInfo } from "./+page.server";

/** Built-in catalog fallback for when the skills bridge is stopped. */
export const LOCAL_SKILLS: Pick<SkillInfo, "name" | "description" | "risk_level">[] = [
  { name: "add_calendar_event", description: "Create an event in Google Calendar", risk_level: "low" },
  { name: "add_todo_item", description: "Add a task to Google Tasks", risk_level: "low" },
  { name: "complete_todo_item", description: "Mark a Google Tasks item as completed", risk_level: "low" },
  { name: "create_file", description: "Create a file at a given path with specified content", risk_level: "medium" },
  { name: "delete_note", description: "Delete a note from the briefing system notes store", risk_level: "low" },
  { name: "list_notes", description: "List notes from the briefing system notes store", risk_level: "low" },
  { name: "open_project_in_editor", description: "Open a project directory in the configured code editor", risk_level: "medium" },
  { name: "propose_prompt_version", description: "Propose a new version of a pipeline prompt", risk_level: "medium" },
  { name: "read_context", description: "Search the harvested long-term context", risk_level: "low" },
  { name: "read_report", description: "Read a daily briefing and its sources", risk_level: "low" },
  { name: "restore_note", description: "Restore a deleted note", risk_level: "low" },
  { name: "revert_context_revision", description: "Undo a correction made to the harvested context", risk_level: "medium" },
  { name: "revise_context", description: "Correct one fact in the harvested long-term context", risk_level: "medium" },
  { name: "run_web_search", description: "Execute a web search query via Brave Search", risk_level: "low" },
  { name: "send_email", description: "Send an email from the system account", risk_level: "medium" },
  { name: "send_mail", description: "Send an email from one of the configured accounts", risk_level: "medium" },
  { name: "set_source_active", description: "Enable or disable an ingestion source", risk_level: "medium" },
  { name: "update_calendar_event", description: "Move, rename or relocate an existing Google Calendar event", risk_level: "medium" },
  { name: "update_note", description: "Edit an existing note", risk_level: "low" },
  { name: "write_note", description: "Write a note to the briefing system notes store", risk_level: "low" },
];
