import type { Skill } from "../src/skills/loader";
import { listQuestions, QUESTION_KINDS, QUESTION_STATUSES } from "../src/questions/store";

const skill: Skill = {
  name: "list_questions",
  description:
    "List the questions on /questions, so you do not ask the same thing twice. Defaults to the open ones; " +
    "pass status to look at answered, dismissed, resolved or merged questions too (answered ones show the user's answer).",
  risk_level: "low",
  parameters: {
    status: { type: "string", required: false, description: `One of: ${QUESTION_STATUSES.join(" | ")} | all. Default: open` },
    kind: { type: "string", required: false, description: `Only this kind: ${QUESTION_KINDS.join(" | ")} (chat = asked by the assistant). Default: every kind` },
    query: { type: "string", required: false, description: "Only questions whose text or answer contains this. Default: no filter" },
    limit: { type: "number", required: false, description: "How many to return, 1 to 200. Default: 100" },
  },
  execute: async (params) => {
    const limit = Math.min(Math.max(Math.trunc(Number(params.limit ?? 100)) || 100, 1), 200);
    const status = params.status ? String(params.status).trim().toLowerCase() : "open";

    const rows = await listQuestions({
      status,
      kind: params.kind ? String(params.kind) : undefined,
      query: params.query ? String(params.query) : undefined,
      limit,
    });
    if (rows.length === 0) return status === "open" ? "No open questions." : `No ${status === "all" ? "" : `${status} `}questions match.`;

    const lines = rows.map((q) => {
      const state = status === "open" ? "" : ` {${q.status}}`;
      const answer = q.answer ? `\n  answer: ${q.answer}` : "";
      return `- [${q.kind}]${state} ${q.question} (${q.id})${answer}`;
    });
    const more = rows.length === limit ? `\n(showing the first ${limit}; narrow the filters or raise limit for more)` : "";
    return `${lines.join("\n")}${more}`;
  },
};

export default skill;
