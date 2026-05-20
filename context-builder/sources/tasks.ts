import { getTasksClient } from "../../src/ingest/google";
import { logError } from "../errors";

export interface TaskItem {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes: string | null;
  due: string | null;
  status: "needsAction" | "completed";
  completedAt: string | null;
}

export async function fetchTaskItems(): Promise<TaskItem[]> {
  try {
    const tasks = await getTasksClient();
    const listsRes = await tasks.tasklists.list({ maxResults: 20 });
    const lists = listsRes.data.items ?? [];

    const results: TaskItem[] = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    for (const list of lists) {
      if (!list.id || !list.title) continue;
      const itemsRes = await tasks.tasks.list({
        tasklist: list.id,
        maxResults: 200,
        showCompleted: true,
        showHidden: false,
      });

      for (const item of itemsRes.data.items ?? []) {
        if (!item.id) continue;
        if (item.status === "completed" && item.completed) {
          const completedAt = new Date(item.completed);
          if (completedAt < cutoff) continue;
        }

        results.push({
          id: item.id,
          listId: list.id,
          listTitle: list.title,
          title: item.title ?? "",
          notes: item.notes ?? null,
          due: item.due ?? null,
          status: (item.status as "needsAction" | "completed") ?? "needsAction",
          completedAt: item.completed ?? null,
        });
      }
    }

    return results;
  } catch (err) {
    await logError("tasks", err);
    return [];
  }
}
