/**
 * Pure helpers for the run breakdown page (`/runs/[id]`; rows come from `pipeline_run_steps`):
 * the span tree, usage rollups, labels and groups, and the compressed time scale. Step ids in
 * `groupOf`/`STEP_LABELS` must match what the pipeline records. Kept free of Svelte and of `$app` imports so they can be tested alone.
 *
 * `pipeline_run_steps` stores counters as per-span *self* values (what that span's own code
 * recorded), so a parent's total is its self plus every descendant's. The root "run" span holds
 * whatever no child claimed.
 */

export interface StepRow {
  id: string;
  parentId: string | null;
  step: string;
  attempt: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
  searchCalls: number;
  flexRetries: number;
  detail: Record<string, unknown> | null;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  aiCalls: number;
  searchCalls: number;
  flexRetries: number;
}

export interface SpanNode extends StepRow {
  depth: number;
  /** Milliseconds from the run's start. */
  offsetMs: number;
  /** Always set: a span still open when the run ended is closed at the run's end. */
  lengthMs: number;
  children: SpanNode[];
  /** Self plus all descendants. */
  total: Usage;
  group: GroupId;
}

export type GroupId =
  | "ingest"
  | "news"
  | "extract"
  | "context"
  | "questions"
  | "synthesis"
  | "finish"
  | "wait";

export interface GroupInfo {
  id: GroupId;
  label: string;
  /** A CSS colour. The first six are the validated dark categorical palette, in order. */
  color: string;
}

export const GROUPS: readonly GroupInfo[] = [
  { id: "ingest", label: "Ingest", color: "#3987e5" },
  { id: "news", label: "News desks", color: "#d95926" },
  { id: "extract", label: "Extraction", color: "#199e70" },
  { id: "context", label: "Context and search", color: "#9085e9" },
  { id: "questions", label: "Question gate", color: "#c64fc4" },
  { id: "synthesis", label: "Synthesis", color: "#008300" },
  { id: "finish", label: "Memory and push", color: "var(--color-surface-400)" },
  { id: "wait", label: "Waiting for answers", color: "var(--color-warning-500)" },
];

const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]));

export function groupInfo(id: GroupId): GroupInfo {
  return GROUP_BY_ID.get(id)!;
}

/** The phase a step belongs to. Unknown steps fall to "finish" rather than to a colour of their own. */
export function groupOf(step: string): GroupId {
  if (step === "phase4-wait") return "wait";
  if (step.startsWith("ingest:") || step === "phase1") return "ingest";
  if (step === "news" || step.startsWith("news:")) return "news";
  if (step === "phase2") return "extract";
  if (step === "phase3" || step === "phase3-websearch") return "context";
  if (step.startsWith("phase4")) return "questions";
  // The news editor writes the report's News section: synthesis, not the desks' research.
  if (["phase5-section1", "phase5-section2", "phase5-news", "phase5-actions"].includes(step)) return "synthesis";
  return "finish";
}

const STEP_LABELS: Record<string, string> = {
  run: "Whole run",
  news: "News desks (all)",
  phase1: "Ingest",
  phase2: "Extraction",
  phase3: "Context",
  "news:repeat-judge": "Repeat judge",
  "news:jev-shadow": "Jev shadow scoring",
  "phase3-websearch": "Web search slots",
  phase4: "Question gate: reconcile",
  "phase4-review": "Question gate: absorb review answers",
  "phase4-questions": "Question gate: reconcile queue",
  "phase4-wait": "Question gate: waiting for your answers",
  "phase5-section1": "Intelligence briefing (Section 1)",
  "phase5-section2": "Personal briefing (Section 2)",
  "phase5-news": "News editor",
  "phase5-actions": "Quick actions",
  phase6: "Memory",
  push: "Push: report",
  "push-questions": "Push: new questions",
  "ingest:rss": "RSS feeds",
  "ingest:calendar": "Google Calendar",
  "ingest:tasks": "Google Tasks",
};

/** A readable name for a step id, falling back to the id for anything this list has not heard of. */
export function stepLabel(step: string): string {
  if (STEP_LABELS[step]) return STEP_LABELS[step];
  if (step.startsWith("ingest:imap:")) return `Mailbox ${step.slice("ingest:imap:".length)}`;
  if (step.startsWith("news:")) return `Desk: ${step.slice("news:".length)}`;
  return step;
}

const ZERO: Usage = { tokensIn: 0, tokensOut: 0, aiCalls: 0, searchCalls: 0, flexRetries: 0 };

function selfUsage(row: StepRow): Usage {
  return {
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    aiCalls: row.aiCalls,
    searchCalls: row.searchCalls,
    flexRetries: row.flexRetries,
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    aiCalls: a.aiCalls + b.aiCalls,
    searchCalls: a.searchCalls + b.searchCalls,
    flexRetries: a.flexRetries + b.flexRetries,
  };
}

export interface RunTree {
  /** The root "run" span, or null when the rows hold none (a run that predates tracing has no rows at all). */
  root: SpanNode | null;
  /** Every span below the root, depth-first in start order: the rows of the time graph. */
  spans: SpanNode[];
  /** The run's length on the time axis. */
  totalMs: number;
}

/**
 * Builds the tree from flat rows. `fallbackEndMs` closes spans that never recorded an end (a run
 * killed mid-step, or one still going) at the run's end instead of leaving a zero-width bar.
 */
export function buildTree(rows: StepRow[], fallbackEndMs?: number): RunTree {
  if (rows.length === 0) return { root: null, spans: [], totalMs: 0 };

  const startOf = (row: StepRow) => new Date(row.startedAt).getTime();
  const rootRow = rows.find((row) => row.parentId == null) ?? rows[0];
  const t0 = startOf(rootRow);

  const lastSeen = Math.max(
    ...rows.map((row) => (row.endedAt ? new Date(row.endedAt).getTime() : startOf(row) + (row.durationMs ?? 0))),
  );
  const endOfRun = fallbackEndMs != null ? Math.max(t0 + fallbackEndMs, lastSeen) : lastSeen;

  const nodes = new Map<string, SpanNode>();
  for (const row of rows) {
    const offsetMs = Math.max(0, startOf(row) - t0);
    const lengthMs = row.durationMs ?? Math.max(0, endOfRun - startOf(row));
    nodes.set(row.id, {
      ...row,
      depth: 0,
      offsetMs,
      lengthMs,
      children: [],
      total: selfUsage(row),
      group: groupOf(row.step),
    });
  }

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
  }

  const root = nodes.get(rootRow.id)!;
  const spans: SpanNode[] = [];
  const walk = (node: SpanNode, depth: number): Usage => {
    node.depth = depth;
    // Pre-order, so a container's row comes before the steps inside it.
    if (node !== root) spans.push(node);
    node.children.sort((a, b) => a.offsetMs - b.offsetMs);
    let total = selfUsage(node);
    for (const child of node.children) total = addUsage(total, walk(child, depth + 1));
    node.total = total;
    return total;
  };
  walk(root, 0);

  // Orphans (a parent row that never got written) would otherwise vanish from the graph.
  for (const node of nodes.values()) {
    if (node !== root && !spans.includes(node)) {
      node.depth = 1;
      spans.push(node);
    }
  }

  const totalMs = Math.max(root.lengthMs, endOfRun - t0, 1);
  return { root, spans, totalMs };
}

export interface GroupTotal extends Usage {
  group: GroupId;
  /** Wall time the group's spans cover, overlaps counted once. */
  wallMs: number;
}

/** Merged length of a set of [start, end) intervals. */
export function unionMs(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [start, end] of sorted) {
    if (curEnd < 0 || start > curEnd) {
      if (curEnd >= 0) total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    } else if (end > curEnd) {
      curEnd = end;
    }
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total;
}

/**
 * Usage and wall time per phase group. Usage is each span's own counters (summing self values over
 * every span counts each call exactly once); wall time is the union of the group's spans, so five
 * parallel news desks are one stretch of the morning rather than five.
 */
export function groupTotals(tree: RunTree): GroupTotal[] {
  const out = new Map<GroupId, { usage: Usage; intervals: [number, number][] }>();
  const bucket = (group: GroupId) => {
    let entry = out.get(group);
    if (!entry) out.set(group, (entry = { usage: ZERO, intervals: [] }));
    return entry;
  };

  const all = tree.root ? [tree.root, ...tree.spans] : tree.spans;
  for (const node of all) {
    // The root's own counters are usage no step claimed; they go to "finish" rather than to a phase.
    const group: GroupId = node === tree.root ? "finish" : node.group;
    const entry = bucket(group);
    entry.usage = addUsage(entry.usage, selfUsage(node));
    if (node !== tree.root) entry.intervals.push([node.offsetMs, node.offsetMs + node.lengthMs]);
  }

  return GROUPS.filter((group) => out.has(group.id)).map((group) => {
    const entry = out.get(group.id)!;
    return { group: group.id, ...entry.usage, wallMs: unionMs(entry.intervals) };
  });
}

/** One attempt-free name: "phase2" for both attempt 1 and attempt 2, for the cost table. */
export interface StepTotal extends Usage {
  step: string;
  group: GroupId;
  attempts: number;
  wallMs: number;
}

/** Totals per step id across attempts, each span's own (self) usage only, for the table. */
export function stepTotals(tree: RunTree): StepTotal[] {
  const byStep = new Map<string, StepTotal>();
  for (const node of tree.spans) {
    // A step that contains other named steps reports its own work only; the children have their own rows.
    const own = selfUsage(node);
    const existing = byStep.get(node.step);
    if (existing) {
      Object.assign(existing, addUsage(existing, own));
      existing.attempts += 1;
      existing.wallMs += node.lengthMs;
    } else {
      byStep.set(node.step, { step: node.step, group: node.group, attempts: 1, wallMs: node.lengthMs, ...own });
    }
  }
  return [...byStep.values()];
}

/**
 * A time axis that can shrink long waits. With no `compress` window the axis is linear. With one,
 * the window is drawn at `windowShare` of the axis (at least) and everything else shares the
 * remainder proportionally, so a 45-minute wait does not flatten a two-minute run into a hairline.
 */
export class TimeScale {
  readonly totalMs: number;
  private readonly cuts: { startMs: number; endMs: number; from: number; to: number }[] = [];

  constructor(totalMs: number, compress: { startMs: number; endMs: number } | null, windowShare = 0.18) {
    this.totalMs = Math.max(1, totalMs);
    const wait = compress ? { startMs: Math.max(0, compress.startMs), endMs: Math.min(this.totalMs, compress.endMs) } : null;

    if (!wait || wait.endMs - wait.startMs <= 0 || (wait.endMs - wait.startMs) / this.totalMs <= windowShare) {
      this.cuts.push({ startMs: 0, endMs: this.totalMs, from: 0, to: 1 });
      return;
    }

    const rest = this.totalMs - (wait.endMs - wait.startMs);
    const before = wait.startMs;
    const after = this.totalMs - wait.endMs;
    const share = rest > 0 ? 1 - windowShare : 0;
    const beforeTo = rest > 0 ? (before / rest) * share : 0;
    const waitTo = beforeTo + windowShare;
    if (before > 0) this.cuts.push({ startMs: 0, endMs: wait.startMs, from: 0, to: beforeTo });
    this.cuts.push({ startMs: wait.startMs, endMs: wait.endMs, from: beforeTo, to: waitTo });
    if (after > 0) this.cuts.push({ startMs: wait.endMs, endMs: this.totalMs, from: waitTo, to: 1 });
  }

  /** Position on the axis, 0 to 1, for a real time offset. */
  at(ms: number): number {
    const clamped = Math.min(Math.max(ms, 0), this.totalMs);
    for (const cut of this.cuts) {
      if (clamped <= cut.endMs) {
        const span = cut.endMs - cut.startMs;
        return span <= 0 ? cut.from : cut.from + ((clamped - cut.startMs) / span) * (cut.to - cut.from);
      }
    }
    return 1;
  }

  get compressed(): boolean {
    return this.cuts.length > 1 || this.cuts[0].to - this.cuts[0].from !== 1;
  }

  /** Axis ticks as real offsets. Placed on the drawn axis, so a compressed window gets its own ticks. */
  ticks(count = 5, minGap = 0.22): number[] {
    if (!this.compressed) return Array.from({ length: count + 1 }, (_, i) => (this.totalMs / count) * i);
    const marks = new Set<number>([0, this.totalMs]);
    for (const cut of this.cuts) {
      marks.add(cut.startMs);
      marks.add(cut.endMs);
    }
    const sorted = [...marks].sort((a, b) => a - b);
    // Labels must not collide on a phone: keep a tick only if it is clear of the last one kept,
    // and let the final tick win over a neighbour crowding it.
    const kept: number[] = [];
    for (const ms of sorted) {
      const last = kept[kept.length - 1];
      if (last == null || this.at(ms) - this.at(last) >= minGap) kept.push(ms);
      else if (ms === this.totalMs) kept[kept.length - 1] = ms;
    }
    return kept;
  }
}

/** The wait span's window, if the run had one. */
export function waitWindow(tree: RunTree): { startMs: number; endMs: number } | null {
  const wait = tree.spans.find((node) => node.step === "phase4-wait");
  return wait ? { startMs: wait.offsetMs, endMs: wait.offsetMs + wait.lengthMs } : null;
}
