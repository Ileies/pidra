import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";
import { isLocalDate } from "../src/util/time";

const skill: Skill = {
  name: "add_todo_item",
  description: "Add a task to Google Tasks. Only the title is needed; it lands in the \"To-Do Now\" list unless list_id says otherwise",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true, description: "Task title" },
    notes: { type: "string", required: false, description: "Optional task notes" },
    due: { type: "string", required: false, description: "Due date (YYYY-MM-DD, or an ISO 8601 date-time whose day is used). Default: no due date" },
    list_id: {
      type: "string",
      required: false,
      description: "Google Tasks list, by name or by ID. Defaults to the list configured in GOOGLE_TASKS_DEFAULT_LIST (\"To-Do Now\")",
    },
    parent_task_id: {
      type: "string",
      required: false,
      description: "Make this a subtask of the task with this ID (from list_todo_items, same list). Default: a top-level task",
    },
  },
  execute: async (params) => {
    const tasks = getTasksClient();
    const listId = await resolveTaskList(params.list_id ? String(params.list_id) : null);
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("title is required");

    const body: Record<string, string> = { title };
    if (params.notes) body.notes = String(params.notes);
    if (params.due) {
      const due = String(params.due).trim();
      const day = due.split("T")[0];
      if (!isLocalDate(day)) throw new Error(`due must be YYYY-MM-DD (got "${due}")`);
      body.due = new Date(day).toISOString();
    }

    const res = await tasks.tasks.insert({
      tasklist: listId,
      parent: params.parent_task_id ? String(params.parent_task_id).trim() : undefined,
      requestBody: body,
    });
    return `Task created: "${res.data.title}"${res.data.due ? ` due ${res.data.due.split("T")[0]}` : ""} (id=${res.data.id})`;
  },
};

export default skill;
