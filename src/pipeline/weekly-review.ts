import { db, questionGateSessions, notes, dailyReports, feedbackEvents, activeTopics } from "../db";
import { eq, desc, gte, and } from "drizzle-orm";
import { synthesize } from "../ai/openai";
import type { GateQuestion, GateAnswer } from "../db/schema";

const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MINUTES = 120;

const WEEKLY_REVIEW_PROMPT = `You are a personal assistant helping the user reflect on their week.
Based on the weekly context provided, generate exactly 3 short, thoughtful reflection questions.
These should probe: what was most valuable, what was missed or deprioritized, and one forward-looking question about next week.
Keep questions concrete and personal. Max 20 words each.
Return ONLY a JSON array of 3 strings: ["question1", "question2", "question3"]`;

const SYNTHESIS_PROMPT = `You are a personal assistant helping the user reflect on their week.
Given the user's answers to three reflection questions, write 2-3 short insight notes (1-2 sentences each).
These will be saved as standing context notes for future briefings.
Focus on actionable insights, patterns, or preferences revealed by the answers.
Return ONLY a JSON array of strings: ["insight1", "insight2", ...]`;

export async function runWeeklyReview(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const weekStart = new Date(Date.now() - 6 * 86400_000).toISOString().split("T")[0];

  // Gather week context for generating good questions
  const recentReports = await db
    .select({ reportDate: dailyReports.reportDate, itemCount: dailyReports.itemCount, itemsIncluded: dailyReports.itemsIncluded })
    .from(dailyReports)
    .where(gte(dailyReports.reportDate, weekStart))
    .orderBy(desc(dailyReports.reportDate));

  const [feedbackRow] = await db
    .select({
      plus: eq(feedbackEvents.eventType, "explicit_plus"),
    })
    .from(feedbackEvents)
    .where(gte(feedbackEvents.createdAt, new Date(Date.now() - 7 * 86400_000).toISOString()))
    .limit(1);

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

  const runId = `weekly-review-${today}`;

  const questions: GateQuestion[] = questionTexts.slice(0, 3).map((q, i) => ({
    id: `${runId}-q${i}`,
    item_type: "review",
    from: "system",
    question: q,
  }));

  const timeoutAt = new Date(Date.now() + TIMEOUT_MINUTES * 60 * 1000).toISOString();

  await db
    .insert(questionGateSessions)
    .values({ runId, runDate: today, questions, status: "pending", timeoutAt })
    .onConflictDoNothing();

  console.log(`[weekly-review] Gate fired with ${questions.length} review questions`);

  // Poll for answers
  const deadline = Date.now() + TIMEOUT_MINUTES * 60 * 1000;
  let answers: GateAnswer[] = [];

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const [session] = await db
      .select({ status: questionGateSessions.status, answers: questionGateSessions.answers })
      .from(questionGateSessions)
      .where(eq(questionGateSessions.runId, runId))
      .limit(1);

    if (session?.status === "answered" && session.answers) {
      answers = session.answers as GateAnswer[];
      break;
    }
  }

  if (answers.length === 0) {
    console.log("[weekly-review] No answers received, skipping synthesis");
    await db.update(questionGateSessions).set({ status: "timed_out" }).where(eq(questionGateSessions.runId, runId));
    return;
  }

  // Synthesize insights from answers
  const answersText = answers
    .map((a) => {
      const q = questions.find((q) => q.id === a.id);
      return `Q: ${q?.question ?? a.id}\nA: ${a.answer}`;
    })
    .join("\n\n");

  const { text: insightsRaw } = await synthesize(SYNTHESIS_PROMPT, answersText);

  let insights: string[];
  try {
    insights = JSON.parse(insightsRaw.match(/\[[\s\S]*\]/)?.[0] ?? "[]");
    if (!Array.isArray(insights)) throw new Error("not array");
  } catch {
    insights = [insightsRaw.slice(0, 500)];
  }

  for (const insight of insights) {
    if (!insight?.trim()) continue;
    await db.insert(notes).values({
      content: insight.trim(),
      scope: "personal",
      createdBy: "system",
    });
  }

  console.log(`[weekly-review] Saved ${insights.length} insight note(s)`);
}
