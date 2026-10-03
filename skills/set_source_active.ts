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
    source_name: { type: "string", required: true, description: "Source name as shown on /sources (exact by default, see match)" },
    active: { type: "boolean", required: true, description: "true enables the source, false disables it" },
    reason: { type: "string", required: false, description: "Why it is being disabled, kept on the row" },
    match: {
      type: "string",
      required: false,
      description: "'exact' (default) needs the exact name; 'partial' accepts part of a name, ignoring case, if it matches exactly one source",
    },
    dry_run: { type: "boolean", required: false, description: "Only report what would change, without changing it. Default: false" },
  },
  execute: async (params) => {
    const sourceName = String(params.source_name ?? "").trim();
    if (!sourceName) throw new Error("source_name is required");

    const active = params.active === true || String(params.active).toLowerCase() === "true";
    const reason = params.reason ? String(params.reason).trim() : null;
    const dryRun = params.dry_run === true || String(params.dry_run).toLowerCase() === "true";

    const match = String(params.match ?? "exact").trim().toLowerCase();
    if (match !== "exact" && match !== "partial") throw new Error(`match must be "exact" or "partial" (got "${match}")`);

    const sources = await db.select({ sourceName: sourceQuality.sourceName, isActive: sourceQuality.isActive }).from(sourceQuality);
    const needle = sourceName.toLowerCase();
    const candidates = sources.filter((s) => s.sourceName.toLowerCase().includes(needle));

    let existing = sources.find((s) => s.sourceName === sourceName);
    if (!existing && match === "partial") {
      if (candidates.length > 1) {
        throw new Error(`"${sourceName}" matches ${candidates.length} sources: ${candidates.map((s) => s.sourceName).join(", ")}. Use a longer part or the exact name.`);
      }
      existing = candidates[0];
    }

    // Refusing an unknown name rather than creating a row for it: a typo would otherwise show up
    // on /sources as a source that does not exist.
    if (!existing) {
      const hint = candidates.length > 0
        ? ` Did you mean: ${candidates.slice(0, 8).map((s) => s.sourceName).join(", ")}? Pass the exact name, or match "partial".`
        : " Use the exact name shown on /sources.";
      throw new Error(`Unknown source "${sourceName}".${hint}`);
    }
    const name = existing.sourceName;

    if (dryRun) {
      const now = existing.isActive === false ? "disabled" : "enabled";
      return `Dry run: source "${name}" is currently ${now}; it would be ${active ? "enabled" : "disabled"}${!active && reason ? ` (${reason})` : ""}. Nothing changed.`;
    }

    const today = new Date().toISOString().split("T")[0];
    await db
      .update(sourceQuality)
      .set({
        isActive: active,
        disabledAt: active ? null : today,
        disabledReason: active ? null : reason,
      })
      .where(eq(sourceQuality.sourceName, name));

    return active
      ? `Source "${name}" enabled; it is ingested again from the next run.`
      : `Source "${name}" disabled${reason ? ` (${reason})` : ""}; it is skipped from the next run.`;
  },
};

export default skill;
