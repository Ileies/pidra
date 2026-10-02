import type { Skill } from "../src/skills/loader";
import { listOpen } from "../src/questions/store";

const skill: Skill = {
  name: "list_questions",
  description: "List the questions waiting for the user on /questions, so you do not ask the same thing twice.",
  risk_level: "low",
  parameters: {},
  execute: async () => {
    const open = await listOpen();
    if (open.length === 0) return "No open questions.";
    return open.map((q) => `- [${q.kind}] ${q.question} (${q.id})`).join("\n");
  },
};

export default skill;
