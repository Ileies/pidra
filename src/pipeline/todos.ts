import { addDays } from "../util/time";
import type { TodoItem } from "../ingest/google";

/**
 * Section 2 receives the open task list as prompt input. A real backlog is hundreds of lines,
 * which both costs input tokens every single day and buries the day's actual signal in a section
 * budgeted at 300-500 words.
 *
 * Rank by how much the task bears on today, then cap. Undated tasks are kept ahead of
 * far-future ones rather than dropped, because Section 2 uses the list to notice that an
 * email's action is "already in to-do", and most backlog items carry no due date at all.
 */
export function prioritiseTodos(items: TodoItem[], runDate: string): TodoItem[] {
  const horizonDays = parseInt(process.env.OPEN_TASKS_HORIZON_DAYS ?? "14");
  const maxItems = parseInt(process.env.OPEN_TASKS_MAX_ITEMS ?? "40");

  const horizonStr = addDays(runDate, horizonDays);

  const rank = (t: TodoItem): number => {
    if (!t.due) return 2;                    // undated backlog: keep, but after anything dated soon
    if (t.due < runDate) return 0;           // overdue
    return t.due <= horizonStr ? 1 : 3;      // inside the horizon, else far future
  };

  const ordered = [...items].sort(
    (a, b) => rank(a) - rank(b) || (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99"),
  );

  if (ordered.length > maxItems) {
    console.log(
      `[Phase 3] ${ordered.length} open todos, sending the ${maxItems} most relevant ` +
      `(overdue and due within ${horizonDays}d first)`,
    );
  }

  return ordered.slice(0, maxItems);
}
