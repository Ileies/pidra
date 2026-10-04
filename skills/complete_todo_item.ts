import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";
import { assertExpectedTitle } from "../src/skills/params";

const skill: Skill = {
  name: "complete_todo_item",
  description: "Mark a Google Tasks item as completed. Find the id with list_todo_items first; to undo, use update_todo_item with reopen",
  risk_level: "low",
  parameters: {
    task_id: { type: "string", required: true, description: "Google Tasks task ID" },
    expected_title: {
      type: "string",
      required: false,
      description: "Safety check: complete only if the task's title contains this text (case-insensitive). Default: no check",
    },
    list_id: {
      type: "string",
      required: false,
      description: "Google Tasks list, by name or by ID. Defaults to the list configured in GOOGLE_TASKS_DEFAULT_LIST (\"To-Do Now\"); pass the task's own list if it lives elsewhere",
    },
  },
  execute: async (params) => {
    const tasks = getTasksClient();
    const listId = await resolveTaskList(params.list_id ? String(params.list_id) : null);
    const taskId = String(params.task_id ?? "").trim();
    if (!taskId) throw new Error("task_id is required");

    if (params.expected_title) {
      const current = await tasks.tasks.get({ tasklist: listId, task: taskId });
      assertExpectedTitle(params.expected_title, current.data.title, "task");
    }

    const res = await tasks.tasks.patch({
      tasklist: listId,
      task: taskId,
      requestBody: { status: "completed" },
    });
    return `Task completed: "${res.data.title}" (id=${res.data.id})`;
  },
};

export default skill;
