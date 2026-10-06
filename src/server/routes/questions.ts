import { Hono } from "hono";
import { HttpError } from "../../util/errors";
import { answerQuestion, dismissQuestion, getAnsweredQuestion, reopenQuestion } from "../../questions/store";
import { processAnswer } from "../../questions/process-answer";
import { bodyOf, uuidParam } from "../http";

export const questions = new Hono();

const RUNNING_FRESH_MS = 15 * 60_000;

// One question at a time from /questions: answer, dismiss, reopen. `src/questions/store.ts` is the
// only writer of the queue; the dashboard only proxies.
questions.post("/api/questions/:id/:op", uuidParam(), async (c) => {
  const id = c.req.param("id");
  const op = c.req.param("op");

  if (op === "answer") {
    const { answer } = await bodyOf<{ answer: unknown }>(c);
    const question = await answerQuestion(id, typeof answer === "string" ? answer : "");
    // Not awaited: acting on the answer is a tool-calling turn that can take a minute. Its result
    // is recorded on the question (`answer_status`) and shown on /questions/closed.
    void processAnswer(question.id);
    return c.json({ id: question.id, status: question.status });
  }
  if (op === "reprocess") {
    const question = await getAnsweredQuestion(id);
    if (question.answerStatus === "done") throw new HttpError("The answer was already acted on", 409);
    // `running` also survives a bridge that died mid-turn, which is what reprocess recovers from,
    // so only a recent start blocks the rerun (`updated_at` is stamped when the status is set).
    const startedMs = question.answerStatus === "running" ? Date.parse(String(question.updatedAt)) : NaN;
    if (Date.now() - startedMs < RUNNING_FRESH_MS) throw new HttpError("The answer is still being acted on", 409);
    void processAnswer(id);
    return c.json({ id, status: question.status });
  }
  if (op === "dismiss" || op === "reopen") {
    const question = await (op === "dismiss" ? dismissQuestion(id) : reopenQuestion(id));
    return c.json({ id: question.id, status: question.status });
  }
  return c.json({ error: "op must be answer, dismiss, reopen or reprocess" }, 400);
});
