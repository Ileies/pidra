import { eq } from "drizzle-orm";
import type { Skill } from "../src/skills/loader";
import { db, sourceQuality } from "../src/db";

/**
 * Enable or disable an ingestion source. A real change to what the system sees, hence medium
 * risk: it is logged prominently in `skill_executions`. Trust scores stay untouchable - those are
 * computed by the weekly scoring job, and letting a model edit its own quality signal would make
 * the signal meaningless.
 */
const skill: Skill = {
  name: "set_source_active",
  description:
    "Enable or disable an ingestion source by its exact name. A disabled source stops being ingested " +
    "from the next pipeline run; its trust score and history are kept. Trust scores themselves cannot be edited.",
  risk_level: "medium",
  parameters: {
    source_name: { type: "string", required: true, description: "Exact source name as shown on /sources" },
    active: { type: "boolean", required: true, description: "true enables the source, false disables it" },
    reason: { type: "string", required: false, description: "Why it is being disabled, kept on the row" },
  },
  execute: async (params) => {
    const sourceName = String(params.source_name ?? "").trim();
    if (!sourceName) throw new Error("source_name is required");

    const active = params.active === true || String(params.active).toLowerCase() === "true";
    const reason = params.reason ? String(params.reason).trim() : null;

    const [existing] = await db
      .select({ sourceName: sourceQuality.sourceName })
      .from(sourceQuality)
      .where(eq(sourceQuality.sourceName, sourceName))
      .limit(1);

    // Refusing an unknown name rather than creating a row for it: a typo would otherwise show up
    // on /sources as a source that does not exist.
    if (!existing) throw new Error(`Unknown source "${sourceName}". Use the exact name shown on /sources.`);

    const today = new Date().toISOString().split("T")[0];
    await db
      .update(sourceQuality)
      .set({
        isActive: active,
        disabledAt: active ? null : today,
        disabledReason: active ? null : reason,
      })
      .where(eq(sourceQuality.sourceName, sourceName));

    return active
      ? `Source "${sourceName}" enabled; it is ingested again from the next run.`
      : `Source "${sourceName}" disabled${reason ? ` (${reason})` : ""}; it is skipped from the next run.`;
  },
};

export default skill;
