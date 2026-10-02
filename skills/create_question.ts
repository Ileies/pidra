import type { Skill } from "../src/skills/loader";
import { createChatQuestion } from "../src/questions/store";

const skill: Skill = {
  name: "create_question",
  description:
    "Put a question to the user in the /questions queue. Use it when you find something only the user can settle - a contact with no name, an entity whose type is unclear, two facts that contradict each other - instead of guessing or leaving it as a remark in prose. " +
    "Run list_questions first so you do not ask what is already open. The question must stand on its own, because it is answered later without this conversation: name the exact contact address, entity or sentence it is about. " +
    "When the user answers, an assistant with edit skills acts on the answer, so ask for the decision, not for a description.",
  risk_level: "low",
  parameters: {
    question: { type: "string", required: true, description: "One self-contained question, in the user's language" },
    why: { type: "string", required: false, description: "What you saw that made you ask; the assistant that processes the answer reads it" },
  },
  execute: async (params, ctx) => {
    const { question, duplicate } = await createChatQuestion(
      String(params.question ?? ""),
      params.why ? String(params.why) : null,
      ctx.conversationId ?? null,
    );
    return duplicate
      ? `That question is already open (${question.id}); nothing added.`
      : `Question ${question.id} added to /questions. It waits there until the user answers it.`;
  },
};

export default skill;
