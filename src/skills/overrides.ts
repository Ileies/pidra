import { eq } from "drizzle-orm";
import { db, skillOverrides } from "../db";
import { getSkill, listSkills, type RiskLevel, type Skill } from "./loader";

export interface SkillOverrideRow {
  skillName: string;
  enabled: boolean;
  riskLevelOverride: RiskLevel | null;
  descriptionOverride: string | null;
  parameterDescriptionOverrides: Record<string, string> | null;
}

export interface SkillPatch {
  enabled?: boolean;
  risk_level?: RiskLevel;
  description?: string;
  parameter_descriptions?: Record<string, string>;
}

const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

export class SkillOverrideError extends Error {}

export async function getOverride(skillName: string): Promise<SkillOverrideRow | null> {
  const [row] = await db.select().from(skillOverrides).where(eq(skillOverrides.skillName, skillName)).limit(1);
  return row ? (row as SkillOverrideRow) : null;
}

async function allOverrides(): Promise<Map<string, SkillOverrideRow>> {
  const rows = await db.select().from(skillOverrides);
  return new Map(rows.map((row) => [row.skillName, row as SkillOverrideRow]));
}

/** The code-defined skill merged with whatever the dashboard has overridden on top of it. */
export interface EffectiveSkill {
  name: string;
  description: string;
  risk_level: RiskLevel;
  parameters: Record<string, { type: string; required: boolean; description?: string }>;
  enabled: boolean;
  base: {
    description: string;
    risk_level: RiskLevel;
  };
  overridden: boolean;
}

function applyOverride(skill: Skill, override: SkillOverrideRow | undefined): EffectiveSkill {
  const parameters: EffectiveSkill["parameters"] = {};
  for (const [name, param] of Object.entries(skill.parameters)) {
    parameters[name] = {
      ...param,
      description: override?.parameterDescriptionOverrides?.[name] ?? param.description,
    };
  }

  return {
    name: skill.name,
    description: override?.descriptionOverride ?? skill.description,
    risk_level: override?.riskLevelOverride ?? skill.risk_level,
    parameters,
    enabled: override?.enabled ?? true,
    base: { description: skill.description, risk_level: skill.risk_level },
    overridden: !!override && (
      override.enabled === false ||
      !!override.riskLevelOverride ||
      !!override.descriptionOverride ||
      !!(override.parameterDescriptionOverrides && Object.keys(override.parameterDescriptionOverrides).length > 0)
    ),
  };
}

export async function listEffectiveSkills(): Promise<EffectiveSkill[]> {
  const overrides = await allOverrides();
  return listSkills().map((skill) => applyOverride(skill, overrides.get(skill.name)));
}

export async function getEffectiveSkill(name: string): Promise<EffectiveSkill | null> {
  const skill = getSkill(name);
  if (!skill) return null;
  const override = await getOverride(name);
  return applyOverride(skill, override ?? undefined);
}

export async function patchSkill(skillName: string, patch: SkillPatch): Promise<EffectiveSkill> {
  const skill = getSkill(skillName);
  if (!skill) throw new SkillOverrideError(`Unknown skill: ${skillName}`);
  if (patch.risk_level && !RISK_LEVELS.includes(patch.risk_level)) {
    throw new SkillOverrideError(`Invalid risk_level: ${patch.risk_level}`);
  }
  // Only known parameter names can get an overridden description - an override that names a
  // parameter the code doesn't have would silently do nothing at execution time.
  if (patch.parameter_descriptions) {
    for (const paramName of Object.keys(patch.parameter_descriptions)) {
      if (!(paramName in skill.parameters)) throw new SkillOverrideError(`Unknown parameter: ${paramName}`);
    }
  }

  const existing = await getOverride(skillName);
  const merged: SkillOverrideRow = {
    skillName,
    enabled: patch.enabled ?? existing?.enabled ?? true,
    riskLevelOverride: patch.risk_level !== undefined ? (patch.risk_level === skill.risk_level ? null : patch.risk_level) : (existing?.riskLevelOverride ?? null),
    descriptionOverride: patch.description !== undefined ? (patch.description.trim() === skill.description ? null : patch.description.trim()) : (existing?.descriptionOverride ?? null),
    parameterDescriptionOverrides: patch.parameter_descriptions !== undefined
      ? { ...(existing?.parameterDescriptionOverrides ?? {}), ...patch.parameter_descriptions }
      : (existing?.parameterDescriptionOverrides ?? null),
  };

  await db
    .insert(skillOverrides)
    .values(merged)
    .onConflictDoUpdate({ target: skillOverrides.skillName, set: { ...merged, updatedAt: new Date().toISOString() } });

  return applyOverride(skill, merged);
}

export async function resetSkill(skillName: string): Promise<EffectiveSkill> {
  const skill = getSkill(skillName);
  if (!skill) throw new SkillOverrideError(`Unknown skill: ${skillName}`);
  await db.delete(skillOverrides).where(eq(skillOverrides.skillName, skillName));
  return applyOverride(skill, undefined);
}
