import { db, dailyReports, activeTopics } from "../db";
import { eq, desc, gte } from "drizzle-orm";
import { synthesize } from "../ai/openai";
import { createNote } from "../notes/store";
import { mechanicalPlan, reconcileQueue, type CandidateInput } from "../questions/reconcile";
import { applyPlan, listOpen, markAbsorbed, unabsorbedReviewAnswers } from "../questions/store";

const WEEKLY_REVIEW_PROMPT = `You are a personal assistant helping the user reflect on their week.
Based on the weekly context provided, generate exactly 3 short, thoughtful reflection questions.
These should probe: what was most valuable, what was missed or deprioritized, and one forward-looking question about next week.
Keep questions concrete and personal. Max 20 words each.
Return ONLY a JSON array of 3 strings: ["question1", "question2", "question3"]`;

const SYNTHESIS_PROMPT = `You are a personal assistant helping the user reflect on their week.
Given the user's answers to reflection questions, write 2-3 short insight notes (1-2 sentences each).
These will be saved as standing context notes for future briefings.
Focus on actionable insights, patterns, or preferences revealed by the answers.
Return ONLY a JSON array of strings: ["insight1", "insight2", ...]`;

/**
 * Adds this week's reflection questions to the question queue and exits.
 *
 * It used to open a session and poll it for two hours, and the unit was gone long before that:
 * every session since 2026-09-20 stayed pending for good, and the one that was answered was
 * answered five days late, after the job had stopped listening. Now the questions go through the
 * same reconcile as the pipeline's, so last week's unanswered ones are rephrased, merged or closed
 * instead of piling up, and `absorbReviewAnswers` turns whatever the reader answers into notes on
 * the next pipeline run.
 */
export async function runWeeklyReview(): Promise<void> {
  const today = new Date().toISOString().split("T")[0]!;
  const weekStart = new Date(Date.now() - 6 * 86400_000).toISOString().split("T")[0];

  // Gather week context for generating good questions
  const recentReports = await db
    .select({ reportDate: dailyReports.reportDate, itemCount: dailyReports.itemCount, itemsIncluded: dailyReports.itemsIncluded })
    .from(dailyReports)
    .where(gte(dailyReports.reportDate, weekStart!))
    .orderBy(desc(dailyReports.reportDate));

  const topTopics = await db
    .select({ headline: activeTopics.headline, domain: activeTopics.domain, updateCount: activeTopics.updateCount })
    .from(activeTopics)
    .where(eq(activeTopics.status, "active"))
    .orderBy(desc(activeTopics.updateCount))
    .limit(5);

  const contextText = `
Week ${weekStart} to ${today}:
- Reports completed: ${recentReports.length}/7, avg items ingested: ${recentReports.length ? Math.round(recentReports.reduce((s, r) => s + (r.itemCount ?? 0), 0) / recentReports.length) : 0}
- Top active topics: ${topTopics.map((t) => `${t.headline} (${t.domain}, ${t.updateCount} updates)`).join("; ")}
`.trim();

  // Generate questions
  const { text: questionsRaw } = await synthesize(WEEKLY_REVIEW_PROMPT, contextText);
  let questionTexts: string[];
  try {
    questionTexts = JSON.parse(questionsRaw.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (!Array.isArray(questionTexts) || questionTexts.length === 0) throw new Error("empty");
  } catch {
    console.error("[weekly-review] Failed to parse questions, aborting");
    return;
  }

  const candidates: CandidateInput[] = questionTexts
    .slice(0, 3)
    .filter((q) => typeof q === "string" && q.trim())
    .map((q) => ({ kind: "review", question: q.trim(), source: null }));

  let plan;
  try {
    plan = (await reconcileQueue(candidates, today)).plan;
  } catch (err) {
    console.error("[weekly-review] Question reconcile failed, adding the questions as they are:", err);
    plan = mechanicalPlan(candidates, await listOpen());
  }
  await applyPlan(plan, today);
  console.log(`[weekly-review] ${candidates.length} review question(s) through the queue`);
}

/**
 * Turns answered review questions into insight notes, once each. Called by Phase 4 of the daily
 * pipeline, so an answer given on Wednesday is a note by Thursday morning. Makes no call when
 * nothing is waiting.
 */
export async function absorbReviewAnswers(): Promise<{ tokensIn: number; tokensOut: number; aiCalls: number }> {
  const answered = await unabsorbedReviewAnswers();
  if (answered.length === 0) return { tokensIn: 0, tokensOut: 0, aiCalls: 0 };

  const answersText = answered.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join("\n\n");
  const result = await synthesize(SYNTHESIS_PROMPT, answersText);

  let insights: string[];
  try {
    insights = JSON.parse(result.text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (!Array.isArray(insights)) throw new Error("not array");
  } catch {
    insights = [result.text.slice(0, 500)];
  }

  let written = 0;
  for (const insight of insights) {
    if (typeof insight !== "string" || !insight.trim()) continue;
    await createNote({ content: insight.trim(), scope: "personal" }, { by: "system" });
    written++;
  }
  await markAbsorbed(answered.map((q) => q.id));

  console.log(`[weekly-review] ${answered.length} review answer(s) absorbed into ${written} note(s)`);
  return { tokensIn: result.tokensIn, tokensOut: result.tokensOut, aiCalls: 1 };
}
