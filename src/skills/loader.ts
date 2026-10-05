import addCalendarEvent from "../../skills/add_calendar_event";
import addContact from "../../skills/add_contact";
import createQuestion from "../../skills/create_question";
import listQuestions from "../../skills/list_questions";
import removeContextItem from "../../skills/remove_context_item";
import addTodoItem from "../../skills/add_todo_item";
import completeTodoItem from "../../skills/complete_todo_item";
import createFile from "../../skills/create_file";
import deleteCalendarEvent from "../../skills/delete_calendar_event";
import deleteNote from "../../skills/delete_note";
import deleteTodoItem from "../../skills/delete_todo_item";
import getCalendarEvent from "../../skills/get_calendar_event";
import listCalendarEvents from "../../skills/list_calendar_events";
import listNotes from "../../skills/list_notes";
import listTodoItems from "../../skills/list_todo_items";
import openProjectInEditor from "../../skills/open_project_in_editor";
import proposePromptVersion from "../../skills/propose_prompt_version";
import readContext from "../../skills/read_context";
import readReport from "../../skills/read_report";
import restoreNote from "../../skills/restore_note";
import revertContextRevision from "../../skills/revert_context_revision";
import reviseContext from "../../skills/revise_context";
import runWebSearch from "../../skills/run_web_search";
import sendEmail from "../../skills/send_email";
import setSourceActive from "../../skills/set_source_active";
import updateCalendarEvent from "../../skills/update_calendar_event";
import updateNote from "../../skills/update_note";
import updateTodoItem from "../../skills/update_todo_item";
import writeNote from "../../skills/write_note";

/**
 * Skill registry and the skill types. Skills live in repo-root skills/*.ts and are registered by
 * hand below (static imports, so `getSkill`/`listSkills` stay synchronous). A new skill must be added
 * here AND placed on a surface or in BRIDGE_ONLY_SKILLS (src/ai/surfaces.ts), or `bun run check` fails.
 * Execution always goes through `executeSkill` (execute.ts). See docs/skills.md.
 */
export type RiskLevel ="low" | "medium" | "high" | "critical";

export interface SkillParam {
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}

/**
 * What `executeSkill` knows about the call, handed to the skill so a write can be attributed.
 * A skill that does not need any of it simply declares `execute: async (params) => ...`.
 */
export interface SkillContext {
  /** The `skill_executions` row this call is already logged under. */
  executionId: string;
  triggeredBy: string;
  /** Set when the call came from the chat, for the provenance trail on what it wrote. */
  conversationId?: string | null;
  /** Who the write is attributed to in a revision trail. */
  actor: "user" | "chat" | "system";
  /** The zone a time without an offset means: the browser's for a chat turn, otherwise UTC. */
  timeZone: string;
}

export interface Skill {
  name: string;
  description: string;
  /**
   * Gating in executeSkill: low/medium run (medium is logged), high parks as `pending` for owner
   * confirmation, critical never runs. Only `low` skills may be run unattended by the pipeline
   * (phase6/skill-suggestions.ts), so a skill that edits something the owner made is not `low`.
   */
  risk_level: RiskLevel;
  /**
   * Whether the skill runs before anyone has touched its switch on /skills. Default true. A skill
   * that sends something outside the system sets false: the owner turns it on by choice.
   */
  default_enabled?: boolean;
  parameters: Record<string, SkillParam>;
  execute: (params: Record<string, unknown>, ctx: SkillContext) => Promise<string>;
}

/** The `{by, skillExecutionId, conversationId}` shape every notes/context writer's `Actor` param expects. */
export function provenanceOf(ctx: SkillContext) {
  return { by: ctx.actor, skillExecutionId: ctx.executionId, conversationId: ctx.conversationId };
}

const registry = new Map<string, Skill>([
  addCalendarEvent,
  addContact,
  createQuestion,
  listQuestions,
  removeContextItem,
  addTodoItem,
  completeTodoItem,
  createFile,
  deleteCalendarEvent,
  deleteNote,
  deleteTodoItem,
  getCalendarEvent,
  listCalendarEvents,
  listNotes,
  listTodoItems,
  openProjectInEditor,
  proposePromptVersion,
  readContext,
  readReport,
  restoreNote,
  revertContextRevision,
  reviseContext,
  runWebSearch,
  sendEmail,
  setSourceActive,
  updateCalendarEvent,
  updateNote,
  updateTodoItem,
  writeNote,
].map((skill): [string, Skill] => [skill.name, skill]));

export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): Skill[] {
  return [...registry.values()];
}
