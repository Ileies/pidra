import { db, extractions, rawItems, questionGateSessions } from "../db";
import { eq, and } from "drizzle-orm";
import type { GateQuestion, GateAnswer } from "../db/schema";

const TIMEOUT_MINUTES = 45;
const POLL_INTERVAL_MS = 10_000;

export interface GateResult {
  fired: boolean;
  runId: string;
  waitForAnswers: () => Promise<Record<string, string>>;
}

export async function runPhase4(runDate: string): Promise<GateResult> {
  const now = new Date();
  const runId = `${runDate}-${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;

  const unknownItems = await db
    .select({
      id: extractions.id,
      questionForUser: extractions.questionForUser,
      sourceName: rawItems.sourceName,
      sourceType: rawItems.sourceType,
      extractedJson: extractions.extractedJson,
    })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(eq(extractions.runDate, runDate), eq(extractions.unknownContext, true)));

  if (unknownItems.length === 0) {
    console.log("[Phase 4] No unknown context items - gate not fired");
    return { fired: false, runId, waitForAnswers: async () => ({}) };
  }

  const questions: GateQuestion[] = unknownItems.map((item) => {
    const json = item.extractedJson as Record<string, unknown> | null;
    return {
      id: item.id,
      item_type: item.sourceType ?? "email",
      from: item.sourceName ?? "unknown",
      subject: (json?.subject as string | undefined),
      question: item.questionForUser ?? `Who is ${item.sourceName ?? "this sender"}? Treat as: lead | partner | personal | unknown?`,
    };
  });

  const timeoutAt = new Date(Date.now() + TIMEOUT_MINUTES * 60 * 1000).toISOString();

  await db
    .insert(questionGateSessions)
    .values({ runId, runDate, questions, status: "pending", timeoutAt })
    .onConflictDoNothing();

  console.log(`[Phase 4] Gate fired - ${questions.length} question(s) for run ${runId}`);

  const waitForAnswers = async (): Promise<Record<string, string>> => {
    const deadline = Date.now() + TIMEOUT_MINUTES * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const [session] = await db
        .select({ status: questionGateSessions.status, answers: questionGateSessions.answers })
        .from(questionGateSessions)
        .where(eq(questionGateSessions.runId, runId))
        .limit(1);

      if (!session) return {};

      if (session.status === "answered" && session.answers) {
        const answers = session.answers as GateAnswer[];
        console.log(`[Phase 4] Gate answered - ${answers.length} answer(s)`);
        return Object.fromEntries(answers.map((a) => [a.id, a.answer]));
      }
    }

    await db
      .update(questionGateSessions)
      .set({ status: "timed_out" })
      .where(eq(questionGateSessions.runId, runId));

    console.log(`[Phase 4] Gate timed out after ${TIMEOUT_MINUTES} minutes`);
    return {};
  };

  return { fired: true, runId, waitForAnswers };
}
