import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";

const skill: Skill = {
  name: "complete_todo_item",
  description: "Mark a Google Tasks item as completed",
  risk_level: "low",
  parameters: {
    task_id: { type: "string", required: true, description: "Google Tasks task ID" },
    list_id: {
      type: "string",
      required: false,
      description: "Google Tasks list, by name or by ID. Defaults to the list configured in GOOGLE_TASKS_DEFAULT_LIST (\"To-Do Now\")",
    },
  },
  execute: async (params) => {
    const tasks = await getTasksClient();
    const listId = await resolveTaskList(params.list_id ? String(params.list_id) : null);
    const taskId = String(params.task_id ?? "").trim();
    if (!taskId) throw new Error("task_id is required");

    const res = await tasks.tasks.patch({
      tasklist: listId,
      task: taskId,
      requestBody: { status: "completed" },
    });
    return `Task completed: "${res.data.title}" (id=${res.data.id})`;
  },
};

export default skill;
