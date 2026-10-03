import type { Skill } from "../src/skills/loader";
import { assertExpectedTitle, getTasksClient, resolveTaskList } from "../src/ingest/google";

const skill: Skill = {
  name: "delete_todo_item",
  description:
    "Delete a Google Tasks item. To finish a task use complete_todo_item instead. Find the id with list_todo_items first, and pass expected_title so a wrong id cannot delete the wrong task",
  risk_level: "medium",
  parameters: {
    task_id: { type: "string", required: true, description: "Google Tasks task ID" },
    expected_title: {
      type: "string",
      required: false,
      description: "Safety check: delete only if the task's title contains this text (case-insensitive). Default: no check",
    },
    list_id: {
      type: "string",
      required: false,
      description: "Google Tasks list, by name or by ID. Defaults to the list configured in GOOGLE_TASKS_DEFAULT_LIST (\"To-Do Now\"); pass the task's own list if it lives elsewhere",
    },
  },
  execute: async (params) => {
    const tasks = await getTasksClient();
    const listId = await resolveTaskList(params.list_id ? String(params.list_id) : null);
    const taskId = String(params.task_id ?? "").trim();
    if (!taskId) throw new Error("task_id is required");

    const existing = await tasks.tasks.get({ tasklist: listId, task: taskId });
    assertExpectedTitle(params.expected_title, existing.data.title, "task");
    await tasks.tasks.delete({ tasklist: listId, task: taskId });
    return `Task deleted: "${existing.data.title}" (id=${taskId})`;
  },
};

export default skill;
