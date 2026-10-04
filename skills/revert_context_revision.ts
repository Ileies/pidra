import { isUuid } from "../src/util/ids";
import type { Skill } from "../src/skills/loader";
import { revertCorrection } from "../src/context/corrections";

const skill: Skill = {
  name: "revert_context_revision",
  description:
    "Undo a correction made by revise_context. Restores any structured row to its pre-correction state and stops the correction being injected. " +
    "The correction row itself is kept - a reverted correction is still part of the record. Find the id with read_context.",
  risk_level: "medium",
  parameters: {
    correction_id: { type: "string", required: true, description: "UUID of the correction to revert" },
  },
  execute: async (params) => {
    const id = String(params.correction_id ?? "").trim();
    if (!isUuid(id)) throw new Error("correction_id must be a UUID");
    return revertCorrection(id);
  },
};

export default skill;
