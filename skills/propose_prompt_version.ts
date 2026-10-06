import { desc, eq } from "drizzle-orm";
import type { Skill } from "../src/skills/loader";
import { db, promptVersions } from "../src/db";
import { PROMPT_SECTIONS } from "../src/ai/active-prompts";
import { approvePromptVersion, createPromptVersion } from "../src/ai/prompt-store";

/**
 * The approval IS the skill's confirmation. It is `high` risk, so `executeSkill` parks every call
 * as `pending` on /skills with the full prompt text in its parameters; nothing is stored until the
 * owner confirms there, and then this inserts the new version and activates it in one step
 * (rejecting stores nothing). `expected_latest_version` is re-checked at confirm time, so a proposal
 * queued before a newer version landed is refused rather than silently replacing it.
 */
const skill: Skill = {
  name: "propose_prompt_version",
  description:
    "Propose a new version of a pipeline prompt. The call is queued on /skills and only takes effect once the " +
    "user confirms it there (that confirmation activates the version) - never claim a proposed prompt is live. " +
    "Pass the full prompt text, not a diff.",
  risk_level: "high",
  touches: [],
  parameters: {
    section: { type: "string", required: true, description: `One of: ${PROMPT_SECTIONS.join(" | ")}` },
    prompt_text: { type: "string", required: true, description: "The complete new prompt text" },
    change_summary: { type: "string", required: false, description: "One or two sentences on what changed and why" },
    expected_latest_version: {
      type: "number",
      required: false,
      description: "Refuse unless the newest stored version of this section is this number (guards against overwriting a newer proposal). Default: no check; 0 means none exists yet",
    },
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

    const expected = params.expected_latest_version;
    if (expected !== undefined && expected !== null && expected !== "") {
      const wanted = Number(expected);
      if (!Number.isInteger(wanted) || wanted < 0) throw new Error("expected_latest_version must be a whole number, 0 or more");
      const [latest] = await db
        .select({ version: promptVersions.version })
        .from(promptVersions)
        .where(eq(promptVersions.section, section))
        .orderBy(desc(promptVersions.version))
        .limit(1);
      if (wanted !== (latest?.version ?? 0)) {
        throw new Error(`${section} is at v${latest?.version ?? 0}, not v${wanted}. Read the newer version before proposing over it.`);
      }
    }

    const row = await createPromptVersion({
      section,
      promptText,
      changeSummary: params.change_summary ? String(params.change_summary).trim() : null,
    });
    await approvePromptVersion(row.id);

    return `Activated ${section} v${row.version} (id=${row.id}). It applies from the next pipeline run.`;
  },
};

export default skill;
