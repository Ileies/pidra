import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";
import { assertExpectedTitle, boolParam } from "../src/skills/params";
import { isLocalDate } from "../src/util/time";

const skill: Skill = {
  name: "update_todo_item",
  description:
    "Change a Google Tasks item: rename it, change its notes or due date, remove the due date, or reopen a completed one. Only the fields given change. Find the id with list_todo_items first",
  risk_level: "medium",
  parameters: {
    task_id: { type: "string", required: true, description: "Google Tasks task ID" },
    title: { type: "string", required: false, description: "New title" },
    notes: { type: "string", required: false, description: "New notes (replaces the old ones; an empty string clears them)" },
    due: { type: "string", required: false, description: "New due date, YYYY-MM-DD" },
    clear_due: { type: "boolean", required: false, description: "Remove the due date. Default: false" },
    reopen: { type: "boolean", required: false, description: "Mark a completed task as open again. Default: false" },
    expected_title: {
      type: "string",
      required: false,
      description: "Safety check: change only if the task's current title contains this text (case-insensitive). Default: no check",
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

    const patch: Record<string, string | null> = {};
    if (params.title) patch.title = String(params.title).trim();
    if (params.notes != null) patch.notes = String(params.notes);
    if (boolParam(params.clear_due)) {
      patch.due = null;
    } else if (params.due) {
      const due = String(params.due).trim();
      if (!isLocalDate(due.split("T")[0])) throw new Error(`due must be YYYY-MM-DD (got "${due}")`);
      patch.due = new Date(due.split("T")[0]).toISOString();
    }
    if (boolParam(params.reopen)) {
      patch.status = "needsAction";
      patch.completed = null;
    }
    if (Object.keys(patch).length === 0) throw new Error("nothing to change: give title, notes, due, clear_due or reopen");

    const res = await tasks.tasks.patch({ tasklist: listId, task: taskId, requestBody: patch });
    return `Task updated (${Object.keys(patch).filter((k) => k !== "completed").join(", ")}): "${res.data.title}" (id=${res.data.id})`;
  },
};

export default skill;
