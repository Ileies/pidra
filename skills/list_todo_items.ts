import type { Skill } from "../src/skills/loader";
import { getTasksClient, resolveTaskList } from "../src/ingest/google";
import { boolParam, intParam } from "../src/skills/params";
import { addDays, isLocalDate, zonedToIso } from "../src/util/time";

/** A `YYYY-MM-DD` as the RFC 3339 instant the Tasks API filters on. A task's due date is a date at UTC midnight, whatever the zone. */
function dueBound(value: unknown, name: string, endOfDay: boolean): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (!isLocalDate(text)) throw new Error(`${name} must be YYYY-MM-DD (got "${text}")`);
  return zonedToIso(`${endOfDay ? addDays(text, 1) : text}T00:00`, "UTC") ?? undefined;
}

const skill: Skill = {
  name: "list_todo_items",
  description:
    "List Google Tasks items, one line each, with their ids and lists. Defaults to all open tasks in every list. update_todo_item, complete_todo_item and delete_todo_item need the id from here",
  risk_level: "low",
  parameters: {
    list_id: { type: "string", required: false, description: "Only this Google Tasks list, by name or ID. Default: every list" },
    query: { type: "string", required: false, description: "Only tasks whose title or notes contain this text" },
    due_from: { type: "string", required: false, description: "Only tasks due on or after this day, YYYY-MM-DD. Default: no lower bound" },
    due_to: { type: "string", required: false, description: "Only tasks due on or before this day, YYYY-MM-DD. Default: no upper bound" },
    include_completed: { type: "boolean", required: false, description: "Also list completed tasks. Default: false" },
    limit: { type: "number", required: false, description: "Maximum number of tasks, 1 to 500. Default: 100" },
  },
  execute: async (params) => {
    const tasks = getTasksClient();
    const lists = params.list_id
      ? [{ id: await resolveTaskList(String(params.list_id)), title: String(params.list_id) }]
      : ((await tasks.tasklists.list({ maxResults: 50 })).data.items ?? []).map((l) => ({ id: l.id ?? "", title: l.title ?? "Tasks" }));

    const query = String(params.query ?? "").trim().toLowerCase();
    const includeCompleted = boolParam(params.include_completed);
    const limit = intParam(params.limit, "limit", 100, 1, 500);
    const dueMin = dueBound(params.due_from, "due_from", false);
    const dueMax = dueBound(params.due_to, "due_to", true);
    const lines: string[] = [];

    for (const list of lists) {
      if (!list.id || lines.length >= limit) continue;
      let pageToken: string | undefined;
      do {
        const res = await tasks.tasks.list({
          tasklist: list.id,
          showCompleted: includeCompleted,
          showHidden: includeCompleted,
          dueMin,
          dueMax,
          maxResults: 100,
          pageToken,
        });
        for (const task of res.data.items ?? []) {
          if (!task.id || lines.length >= limit) continue;
          if (!includeCompleted && task.status === "completed") continue;
          if (query && !`${task.title ?? ""} ${task.notes ?? ""}`.toLowerCase().includes(query)) continue;
          const due = task.due ? ` | due ${task.due.split("T")[0]}` : "";
          const done = task.status === "completed" ? " | completed" : "";
          lines.push(`- ${task.title ?? "(no title)"} | list: ${list.title}${due}${done} | id=${task.id}`);
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && lines.length < limit);
    }

    if (lines.length === 0) return `No ${includeCompleted ? "" : "open "}tasks${query ? ` matching "${query}"` : ""}.`;
    return lines.join("\n") + (lines.length >= limit ? `\n(showing the first ${limit}; narrow the filters or raise limit for more)` : "");
  },
};

export default skill;
