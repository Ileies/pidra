import { expect, test } from "bun:test";
import { buildTree, groupOf, groupTotals, stepTotals, TimeScale, unionMs, waitWindow, type StepRow } from "../src/lib/runTrace.js";

const T0 = Date.parse("2026-10-01T06:00:00.000Z");

function row(id: string, parentId: string | null, step: string, startSec: number, lenSec: number, usage: Partial<StepRow> = {}): StepRow {
  return {
    id,
    parentId,
    step,
    attempt: 1,
    status: "ok",
    startedAt: new Date(T0 + startSec * 1000).toISOString(),
    endedAt: new Date(T0 + (startSec + lenSec) * 1000).toISOString(),
    durationMs: lenSec * 1000,
    tokensIn: 0,
    tokensOut: 0,
    aiCalls: 0,
    searchCalls: 0,
    flexRetries: 0,
    detail: null,
    ...usage,
  };
}

const rows: StepRow[] = [
  row("r", null, "run", 0, 3000, { tokensIn: 5 }),
  row("p2", "r", "phase2", 10, 30, { tokensIn: 1000, tokensOut: 200, aiCalls: 4 }),
  row("n", "r", "news", 0, 60),
  row("n1", "n", "news:world", 0, 50, { tokensIn: 2000, tokensOut: 400, aiCalls: 3, searchCalls: 6 }),
  row("p4", "r", "phase4", 60, 20),
  row("w", "r", "phase4-wait", 80, 2700),
  row("s2", "r", "phase5-section2", 2780, 100, { tokensIn: 3000, tokensOut: 800, aiCalls: 1 }),
];

test("rolls descendants into the parent's total, once", () => {
  const tree = buildTree(rows);
  const news = tree.spans.find((node) => node.step === "news")!;
  expect(news.total.tokensIn).toBe(2000);
  expect(news.total.searchCalls).toBe(6);
  expect(tree.root!.total.tokensIn).toBe(5 + 1000 + 2000 + 3000);
  expect(tree.spans.some((node) => node.step === "run")).toBe(false);
});

test("groups and totals", () => {
  expect(groupOf("ingest:imap:a")).toBe("ingest");
  expect(groupOf("phase4-wait")).toBe("wait");
  expect(groupOf("phase5-news")).toBe("news");
  expect(groupOf("something-new")).toBe("finish");

  const totals = groupTotals(buildTree(rows));
  const news = totals.find((entry) => entry.group === "news")!;
  // news (0-60) and news:world (0-50) overlap: counted once.
  expect(news.wallMs).toBe(60_000);
  expect(news.tokensIn).toBe(2000);
  expect(totals.find((entry) => entry.group === "finish")!.tokensIn).toBe(5);

  const steps = stepTotals(buildTree(rows));
  expect(steps.reduce((sum, entry) => sum + entry.tokensIn, 0)).toBe(6000);
});

test("union of intervals", () => {
  expect(unionMs([[0, 10], [5, 20], [30, 40]])).toBe(30);
  expect(unionMs([])).toBe(0);
});

test("a linear scale maps offsets proportionally", () => {
  const scale = new TimeScale(1000, null);
  expect(scale.at(0)).toBe(0);
  expect(scale.at(250)).toBeCloseTo(0.25);
  expect(scale.at(1000)).toBe(1);
  expect(scale.compressed).toBe(false);
});

test("a compressed wait keeps the window at its share and stays monotonic", () => {
  const tree = buildTree(rows);
  const wait = waitWindow(tree)!;
  const scale = new TimeScale(tree.totalMs, wait, 0.2);
  expect(scale.compressed).toBe(true);
  expect(scale.at(wait.endMs) - scale.at(wait.startMs)).toBeCloseTo(0.2);
  expect(scale.at(0)).toBe(0);
  expect(scale.at(tree.totalMs)).toBeCloseTo(1);
  let last = -1;
  for (let ms = 0; ms <= tree.totalMs; ms += 5000) {
    const at = scale.at(ms);
    expect(at).toBeGreaterThanOrEqual(last);
    last = at;
  }
});

test("a short wait is left alone", () => {
  const scale = new TimeScale(1000, { startMs: 100, endMs: 150 }, 0.2);
  expect(scale.compressed).toBe(false);
});

test("an unfinished span is closed at the run's end", () => {
  const open = row("o", "r", "phase6", 100, 0, { status: "running", endedAt: null, durationMs: null });
  const tree = buildTree([row("r", null, "run", 0, 150), open], 200_000);
  expect(tree.spans[0].lengthMs).toBe(100_000);
});

test("no rows means no tree", () => {
  expect(buildTree([]).root).toBeNull();
});
