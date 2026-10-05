import { fmtCost, fmtNum } from "#lib/format.js";
import type { NavTarget, QuickAction } from "#lib/report/types.js";
import type { RenderedReport, RenderedEntry } from "#lib/server/reports.js";

export interface RunStat {
  label: string;
  value: string;
  title?: string;
}

interface StatsReport {
  itemCount: number | null;
  itemsIncluded: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  aiCalls?: number | null;
  webSearchesRun?: number | null;
}

/** The figures under the report: how much arrived, how much made it, and what it cost. */
export function runStats(report: StatsReport | null, cost: number | null, costTitle: string): RunStat[] {
  if (!report) return [];
  return [
    { label: "ingested", value: fmtNum(report.itemCount) },
    { label: "included", value: fmtNum(report.itemsIncluded) },
    { label: "tokens in", value: fmtNum(report.tokensIn), title: costTitle },
    { label: "tokens out", value: fmtNum(report.tokensOut), title: costTitle },
    ...(report.aiCalls != null ? [{ label: "AI calls", value: fmtNum(report.aiCalls) }] : []),
    ...(report.webSearchesRun ? [{ label: "web searches", value: fmtNum(report.webSearchesRun) }] : []),
    ...(cost != null ? [{ label: "cost", value: fmtCost(cost) }] : []),
  ];
}

/**
 * Each action sits under the first personal entry that cites one of its mails, so the button is
 * next to the text that explains it. One the report never mentions (an automated booking
 * confirmation the gate kept out of Section 2, or a mail Section 2 left out) goes in its own
 * block at the end of the section, with the agent's one line on what the mail asked.
 */
export function placeActions(structured: RenderedReport | null, actions: QuickAction[]) {
  const entries = structured?.personal.flatMap((group) => group.entries) ?? [];
  const byEntry = new Map<RenderedEntry, QuickAction[]>();
  const unplaced: QuickAction[] = [];
  for (const action of actions) {
    const entry = entries.find((e) => e.refIds.some((id) => action.sourceIds.includes(id)));
    if (entry) byEntry.set(entry, [...(byEntry.get(entry) ?? []), action]);
    else unplaced.push(action);
  }
  return { byEntry, unplaced };
}

/**
 * The jump targets in reading order: the News groups come before the briefing's domains.
 * The ids (`news-N`, `domain-N`, and below `personal`/`news`/`intel`) must match the element ids
 * rendered by NewsSection and `/[date]/+page.svelte` (`groupWrapper`).
 */
export function domainTargets(structured: RenderedReport | null): NavTarget[] {
  return [
    ...(structured?.news ?? []).map((group, index) => ({ id: `news-${index}`, label: group.group })),
    ...(structured?.intel ?? []).map((group, index) => ({ id: `domain-${index}`, label: group.domain })),
  ];
}

/** The top-level sections that have something in them. */
export function sectionTargets(structured: RenderedReport | null, hasPersonal: boolean): NavTarget[] {
  return [
    hasPersonal ? { id: "personal", label: "Personal" } : null,
    (structured?.news?.length ?? 0) > 0 ? { id: "news", label: "News" } : null,
    (structured?.intel.length ?? 0) > 0 ? { id: "intel", label: "Briefing" } : null,
  ].filter((target): target is NavTarget => target !== null);
}
