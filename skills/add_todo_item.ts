import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";

const skill: Skill = {
  name: "add_todo_item",
  description: "Add a task to Google Tasks",
  risk_level: "low",
  parameters: {
    title: { type: "string", required: true, description: "Task title" },
    notes: { type: "string", required: false, description: "Optional task notes" },
    due: { type: "string", required: false, description: "Due date (ISO 8601, e.g. 2026-05-21)" },
    list_id: {
      type: "string",
      required: false,
      description: "Google Tasks list, by name or by ID. Defaults to the list configured in GOOGLE_TASKS_DEFAULT_LIST (\"To-Do Now\")",
    },
  },
  execute: async (params) => {
    const tasks = await getTasksClient();
    const listId = await resolveTaskList(params.list_id ? String(params.list_id) : null);
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("title is required");

    const body: Record<string, string> = { title };
    if (params.notes) body.notes = String(params.notes);
    if (params.due) body.due = new Date(String(params.due)).toISOString();

    const res = await tasks.tasks.insert({ tasklist: listId, requestBody: body });
    return `Task created: "${res.data.title}" (id=${res.data.id})`;
  },
};

export default skill;
