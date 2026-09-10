import { db, dailyReports, extractions, feedbackEvents, entities, activeTopics, sourceQuality, notes } from "../db";
import { and, gte, lte, eq, sql as drizzleSql, desc, count, avg } from "drizzle-orm";
import { PROMPT_SECTIONS, resolveActivePrompts } from "../ai/active-prompts";
import { openai, SYNTHESIS_MODEL as MODEL, withFlexRetry } from "../ai/openai";

export interface WeeklyAnalytics {
  weekStart: string;
  weekEnd: string;
  runsCompleted: number;
  avgDuration?: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalAiCalls: number;
  totalWebSearches: number;
  avgItemsIngested: number;
  avgIncludeRate: number;
  topSources: { name: string; avgComposite: number }[];
  bottomSources: { name: string; avgComposite: number }[];
  feedbackPlus: number;
  feedbackMinus: number;
  newEntities: number;
  dormantEntities: number;
  activeTopicCount: number;
  resolvedTopicCount: number;
}

export async function computeWeeklyAnalytics(weekStart: string): Promise<WeeklyAnalytics> {
  const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 86400_000).toISOString().split("T")[0];

  const reports = await db
    .select()
    .from(dailyReports)
    .where(and(gte(dailyReports.reportDate, weekStart), lte(dailyReports.reportDate, weekEnd)));

  const totalTokensIn = reports.reduce((s, r) => s + (r.tokensIn ?? 0), 0);
  const totalTokensOut = reports.reduce((s, r) => s + (r.tokensOut ?? 0), 0);
  const totalAiCalls = reports.reduce((s, r) => s + (r.aiCalls ?? 0), 0);
  const totalWebSearches = reports.reduce((s, r) => s + (r.webSearchesRun ?? 0), 0);
  const avgItemsIngested = reports.length ? reports.reduce((s, r) => s + (r.itemCount ?? 0), 0) / reports.length : 0;

  const totalIncluded = reports.reduce((s, r) => s + (r.itemsIncluded ?? 0), 0);
  const totalItems = reports.reduce((s, r) => s + (r.itemCount ?? 0), 0);
  const avgIncludeRate = totalItems > 0 ? totalIncluded / totalItems : 0;

  const [feedbackRow] = await db
    .select({
      plus: drizzleSql<number>`count(*) filter (where event_type = 'explicit_plus')`,
      minus: drizzleSql<number>`count(*) filter (where event_type = 'explicit_minus')`,
    })
    .from(feedbackEvents)
    .where(and(
      gte(drizzleSql`created_at::date`, drizzleSql`${weekStart}::date`),
      lte(drizzleSql`created_at::date`, drizzleSql`${weekEnd}::date`),
    ));

  const newEntitiesCount = await db
    .select({ c: count() })
    .from(entities)
    .where(and(gte(entities.firstSeen, weekStart), lte(entities.firstSeen, weekEnd)));

  const dormantCount = await db
    .select({ c: count() })
    .from(entities)
    .where(eq(entities.status, "dormant"));

  const activeTopicCount = (await db.select({ c: count() }).from(activeTopics).where(eq(activeTopics.status, "active")))[0].c;
  const resolvedTopicCount = (await db.select({ c: count() }).from(activeTopics).where(and(
    eq(activeTopics.status, "resolved"),
    gte(activeTopics.lastUpdated, weekStart),
    lte(activeTopics.lastUpdated, weekEnd),
  )))[0].c;

  const sourcesAll = await db
    .select({ sourceName: sourceQuality.sourceName, score: sourceQuality.compositeScore30d })
    .from(sourceQuality)
    .where(eq(sourceQuality.isActive, true))
    .orderBy(desc(sourceQuality.compositeScore30d));

  const topSources = sourcesAll.slice(0, 3).map((s) => ({ name: s.sourceName, avgComposite: s.score ?? 0 }));
  const bottomSources = [...sourcesAll].reverse().slice(0, 3).map((s) => ({ name: s.sourceName, avgComposite: s.score ?? 0 }));

  return {
    weekStart,
    weekEnd,
    runsCompleted: reports.length,
    totalTokensIn,
    totalTokensOut,
    totalAiCalls,
    totalWebSearches,
    avgItemsIngested: Math.round(avgItemsIngested),
    avgIncludeRate: Math.round(avgIncludeRate * 100) / 100,
    topSources,
    bottomSources,
    feedbackPlus: Number(feedbackRow?.plus ?? 0),
    feedbackMinus: Number(feedbackRow?.minus ?? 0),
    newEntities: newEntitiesCount[0].c,
    dormantEntities: dormantCount[0].c,
    activeTopicCount: Number(activeTopicCount),
    resolvedTopicCount: Number(resolvedTopicCount),
  };
}

export async function generatePromptDiff(analytics: WeeklyAnalytics): Promise<string | null> {
  // The effective prompts, not just the rows in `prompt_versions`. The table is empty until the
  // first version is approved, and reviewing nothing was the wrong answer for that state: the
  // baselines in the code are what the week actually ran on.
  const effective = await resolveActivePrompts();

  const analyticsText = `
Weekly PIDRA Analytics (${analytics.weekStart} to ${analytics.weekEnd}):
- Runs completed: ${analytics.runsCompleted}/7
- Avg items ingested: ${analytics.avgItemsIngested} | Include rate: ${(analytics.avgIncludeRate * 100).toFixed(0)}%
- Tokens in: ${analytics.totalTokensIn.toLocaleString()} | Tokens out: ${analytics.totalTokensOut.toLocaleString()} | AI calls: ${analytics.totalAiCalls}
- Web searches: ${analytics.totalWebSearches}
- User feedback: +${analytics.feedbackPlus} / -${analytics.feedbackMinus}
- New entities this week: ${analytics.newEntities} | Dormant total: ${analytics.dormantEntities}
- Active topics: ${analytics.activeTopicCount} | Resolved this week: ${analytics.resolvedTopicCount}
- Top sources: ${analytics.topSources.map((s) => `${s.name} (${s.avgComposite.toFixed(1)})`).join(", ")}
- Bottom sources: ${analytics.bottomSources.map((s) => `${s.name} (${s.avgComposite.toFixed(1)})`).join(", ")}
`.trim();

  const promptSummary = PROMPT_SECTIONS
    .map((section) => {
      const p = effective[section];
      const label = p.source === "db" ? `v${p.version}` : "code baseline";
      return `=== ${section} (${label}) ===\n${p.text.slice(0, 600)}${p.text.length > 600 ? "…" : ""}`;
    })
    .join("\n\n");

  const response = await withFlexRetry(() =>
    openai.chat.completions.create({
      model: MODEL,
      store: false,
      service_tier: "flex",
      messages: [
        {
          role: "system",
          content:
            "You are a prompt engineer for a personal morning briefing system. Analyze the weekly performance analytics and the prompts the week actually ran on. Each prompt is labelled either with its approved version number or as 'code baseline', which means no version has been approved for that section yet. Suggest specific, targeted improvements to the prompts that would improve relevance scoring, reduce false positives, or better capture what the user values. Output ONLY a structured diff proposal - for each change: which section, what to change, and why. Nothing you propose is applied automatically: a human reviews it and approves it as a new version. Be conservative: only suggest changes with clear evidence from the analytics. If no changes are warranted, say so explicitly.",
        },
        {
          role: "user",
          content: `${analyticsText}\n\n${promptSummary}`,
        },
      ],
      max_completion_tokens: 1000,
    })
  );

  return response.choices[0].message.content ?? null;
}

export async function runWeeklyMetaRun(): Promise<void> {
  const today = new Date();
  // Compute analytics for the week that just ended (Mon–Sun)
  const dayOfWeek = today.getDay(); // 0=Sun
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(today.getTime() - (daysBack + 7) * 86400_000).toISOString().split("T")[0];

  console.log(`[meta-run] Computing weekly analytics for week of ${weekStart}`);

  const analytics = await computeWeeklyAnalytics(weekStart);

  console.log(`[meta-run] ${analytics.runsCompleted} runs | +${analytics.feedbackPlus}/-${analytics.feedbackMinus} feedback | ${analytics.newEntities} new entities`);

  const diff = await generatePromptDiff(analytics);

  if (diff) {
    await db.insert(notes).values({
      content: `WEEKLY META-RUN PROMPT DIFF PROPOSAL (${analytics.weekStart}):\n\n${diff}`,
      scope: "global",
      createdBy: "system",
    });
    console.log(`[meta-run] Prompt diff saved to notes`);
  } else {
    console.log(`[meta-run] No prompt changes suggested`);
  }
}
