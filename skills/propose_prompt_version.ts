import { desc, eq } from "drizzle-orm";
import type { Skill } from "../src/skills/loader";
import { db, promptVersions } from "../src/db";
import { PROMPT_SECTIONS } from "../src/ai/active-prompts";

/**
 * Prompt changes require human approval, so this only ever inserts an **inactive** version. The
 * user activates it on /prompts, which is the one place that flips `active`. Nothing here can
 * make a prompt live, by design.
 */
const skill: Skill = {
  name: "propose_prompt_version",
  description:
    "Propose a new version of a pipeline prompt. It is stored as INACTIVE and only takes effect once the " +
    "user activates it on /prompts - never claim a proposed prompt is live. Pass the full prompt text, not a diff.",
  risk_level: "medium",
  parameters: {
    section: { type: "string", required: true, description: `One of: ${PROMPT_SECTIONS.join(" | ")}` },
    prompt_text: { type: "string", required: true, description: "The complete new prompt text" },
    change_summary: { type: "string", required: false, description: "One or two sentences on what changed and why" },
  },
  execute: async (params) => {
    const section = String(params.section ?? "").trim();
    if (!(PROMPT_SECTIONS as readonly string[]).includes(section)) {
      throw new Error(`section must be one of ${PROMPT_SECTIONS.join(", ")}`);
    }

    const promptText = String(params.prompt_text ?? "").trim();
    if (promptText.length < 100) {
      throw new Error("prompt_text must be the full prompt, not a fragment or a diff");
    }

    const [latest] = await db
      .select({ version: promptVersions.version })
      .from(promptVersions)
      .where(eq(promptVersions.section, section))
      .orderBy(desc(promptVersions.version))
      .limit(1);

    const [row] = await db
      .insert(promptVersions)
      .values({
        section,
        promptText,
        changeSummary: params.change_summary ? String(params.change_summary).trim() : null,
        version: (latest?.version ?? 0) + 1,
        active: false,
      })
      .returning({ id: promptVersions.id, version: promptVersions.version });

    return `Proposed ${section} v${row.version} (id=${row.id}) as inactive. It changes nothing until you activate it on /prompts.`;
  },
};

export default skill;
