/**
 * Pure helper for the run summary bar: which phase groups were active over which stretch of the run.
 * Kept apart from `runTrace.ts` (at its file-size ceiling); no Svelte imports so it can be tested alone.
 */
import { GROUPS, type GroupId, type RunTree } from "#lib/runTrace.js";

export interface TimelineSegment {
  startMs: number;
  endMs: number;
  /** Groups running during the stretch, one per stripe slot (a group keeps its slot from the previous stretch). Never empty. */
  groups: GroupId[];
}

/**
 * Splits the run into stretches with a constant set of active groups. Stretches where no step ran
 * are left out; adjacent stretches with the same set are merged. A stretch with two or more groups
 * is a parallel one.
 */
export function timelineSegments(tree: RunTree): TimelineSegment[] {
  const bounds = new Set<number>();
  for (const node of tree.spans) {
    bounds.add(node.offsetMs);
    bounds.add(node.offsetMs + node.lengthMs);
  }
  const points = [...bounds].sort((a, b) => a - b);

  const out: TimelineSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [startMs, endMs] = [points[i], points[i + 1]];
    const active = new Set<GroupId>();
    for (const node of tree.spans) {
      if (node.offsetMs < endMs && node.offsetMs + node.lengthMs > startMs) active.add(node.group);
    }
    if (active.size === 0) continue;
    const last = out[out.length - 1];
    const groups = slotOrder(active, last?.groups ?? []);
    if (last && last.endMs === startMs && last.groups.join() === groups.join()) last.endMs = endMs;
    else out.push({ startMs, endMs, groups });
  }
  return out;
}

/**
 * Orders the active groups so one that was also active in the previous stretch keeps its position,
 * which lets the bar draw its stripes in the same place across neighbouring parallel stretches.
 */
function slotOrder(active: ReadonlySet<GroupId>, previous: readonly GroupId[]): GroupId[] {
  const slots: (GroupId | null)[] = Array(active.size).fill(null);
  previous.forEach((id, i) => {
    if (active.has(id) && i < slots.length) slots[i] = id;
  });
  const fresh = GROUPS.map((group) => group.id).filter((id) => active.has(id) && !slots.includes(id));
  return slots.map((slot) => slot ?? fresh.shift()!);
}
