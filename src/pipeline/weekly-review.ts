import { utcDay, daysAgo } from "../util/time";
import { db, dailyReports, activeTopics } from "../db";
import { eq, desc, gte } from "drizzle-orm";
import { synthesize } from "../ai/openai";
import { renderPromptText } from "../ai/active-prompts";
import { createNote } from "../notes/store";
import { mechanicalPlan } from "../questions/plan";
import { reconcileQueue, type CandidateInput } from "../questions/reconcile";
import { applyPlan } from "../questions/apply-plan";
import { listOpen, markAbsorbed, unabsorbedReviewAnswers } from "../questions/store";

// The cap covers reasoning tokens too, so it sits well above the default 4096 that high effort would exhaust.
const REVIEW_OPTS = { reasoningEffort: "high", maxOutputTokens: 12000 } as const;

const WEEKLY_REVIEW_PROMPT = `You are a personal assistant helping the user reflect on their week.
Based on the weekly context provided, decide whether this week actually gives you something worth
asking the reader to reflect on. If it does, generate up to 3 short, thoughtful reflection questions -
never invent one just to reach a count. A quiet week with nothing notable can warrant none.
When there is something worth asking, draw from: what was most valuable, what was missed or
deprioritized, and a forward-looking question about next week - whichever of those the week's context
actually supports. Ground every question in the context given, not a generic template.
Keep questions concrete and personal. Max 20 words each. Write them in {{language}}.
Return ONLY a JSON array of 0 to 3 strings, e.g. ["question1", "question2"], or [] if none are warranted.`;

const SYNTHESIS_PROMPT = `You are a personal assistant helping the user reflect on their week.
Given the user's answers to reflection questions, write 2-3 short insight notes (1-2 sentences each).
These will be saved as standing context notes for future briefings.
Focus on actionable insights, patterns, or preferences revealed by the answers. Write them in {{language}}.
Return ONLY a JSON array of strings: ["insight1", "insight2", ...]`;

/**
 * The `review` job (src/job.ts): adds this week's reflection questions (kind "review") to the
 * question queue and exits without waiting for answers. They go through the same reconcile as the
 * pipeline's, so last week's unanswered ones are rephrased, merged or closed, and
 * `absorbReviewAnswers` turns the reader's answers into notes on the next pipeline run.
 */
export async function runWeeklyReview(): Promise<void> {
  const today = utcDay();
  const weekStart = daysAgo(6);

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

  // Generate questions. An empty array is a legitimate result - a quiet week with nothing worth
  // asking about - not a failure, so only a parse error aborts the run.
  const { text: questionsRaw } = await synthesize(await renderPromptText(WEEKLY_REVIEW_PROMPT), contextText, REVIEW_OPTS);
  let questionTexts: string[];
  try {
    const parsed = JSON.parse(questionsRaw.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (!Array.isArray(parsed)) throw new Error("not an array");
    questionTexts = parsed;
  } catch {
    console.error("[weekly-review] Failed to parse questions, aborting");
    return;
  }

  const candidates: CandidateInput[] = questionTexts
    .slice(0, 3)
    .filter((q) => typeof q === "string" && q.trim())
    .map((q) => ({ kind: "review", question: q.trim(), source: null }));

  if (candidates.length === 0) {
    console.log("[weekly-review] Nothing worth asking this week");
    return;
  }

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
 *
 * A single answered question needs no paraphrase: there is nothing to combine, and every rewrite
 * is a chance to drift from what the reader actually said, so it becomes a note close to verbatim
 * with no model call at all. `SYNTHESIS_PROMPT` only runs when there is more than one answer to
 * genuinely combine into a pattern. Either way the note carries `sourceQuestionIds`, so a bad
 * insight can be traced back to what was actually asked and answered.
 */
export async function absorbReviewAnswers(): Promise<{ tokensIn: number; tokensOut: number; aiCalls: number }> {
  const answered = await unabsorbedReviewAnswers();
  if (answered.length === 0) return { tokensIn: 0, tokensOut: 0, aiCalls: 0 };

  if (answered.length === 1) {
    const q = answered[0]!;
    await createNote(
      { content: `${q.question} ${q.answer}`.trim(), scope: "personal", sourceQuestionIds: [q.id] },
      { by: "system" },
    );
    await markAbsorbed([q.id]);
    console.log(`[weekly-review] 1 review answer absorbed into 1 note (verbatim)`);
    return { tokensIn: 0, tokensOut: 0, aiCalls: 0 };
  }

  const answersText = answered.map((q) => `Q: ${q.question}\nA: ${q.answer}`).join("\n\n");
  const result = await synthesize(await renderPromptText(SYNTHESIS_PROMPT), answersText, REVIEW_OPTS);

  let insights: string[];
  try {
    insights = JSON.parse(result.text.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (!Array.isArray(insights)) throw new Error("not array");
  } catch {
    insights = [result.text.slice(0, 500)];
  }

  const sourceQuestionIds = answered.map((q) => q.id);
  let written = 0;
  for (const insight of insights) {
    if (typeof insight !== "string" || !insight.trim()) continue;
    await createNote({ content: insight.trim(), scope: "personal", sourceQuestionIds }, { by: "system" });
    written++;
  }
  await markAbsorbed(answered.map((q) => q.id));

  console.log(`[weekly-review] ${answered.length} review answer(s) absorbed into ${written} note(s)`);
  return { tokensIn: result.tokensIn, tokensOut: result.tokensOut, aiCalls: 1 };
}
