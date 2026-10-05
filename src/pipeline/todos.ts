import { addDays } from "../util/time";
import type { TodoItem } from "../ingest/google";

/**
 * Caps the open task list that Section 2 receives (called by Phase 3). Order: overdue, due within
 * `OPEN_TASKS_HORIZON_DAYS` (default 14), undated, far future; then at most `OPEN_TASKS_MAX_ITEMS`
 * (default 40). Undated tasks are kept rather than dropped because Section 2 uses the list to notice
 * that an email's action is "already in to-do".
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
