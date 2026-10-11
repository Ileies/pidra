/**
 * Absorbs answers to `review` questions, the weekly reflection questions the system used to ask.
 * Nothing asks them any more (questions about the reader come from `src/questions/discover.ts`),
 * but ones still open can be answered, and those answers become notes here.
 */
import { synthesize } from "../ai/openai";
import { renderPromptText } from "../ai/active-prompts";
import { createNote } from "../notes/store";
import { markAbsorbed, unabsorbedReviewAnswers } from "../questions/store";

// The cap covers reasoning tokens too, so it sits well above the default 4096 that high effort would exhaust.
const REVIEW_OPTS = { reasoningEffort: "high", maxOutputTokens: 12000 } as const;

const SYNTHESIS_PROMPT = `You are a personal assistant helping the user reflect on their week.
Given the user's answers to reflection questions, write 2-3 short insight notes (1-2 sentences each).
These will be saved as standing context notes for future briefings.
Focus on actionable insights, patterns, or preferences revealed by the answers. Write them in {{language}}.
Return ONLY a JSON array of strings: ["insight1", "insight2", ...]`;

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
