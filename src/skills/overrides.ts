import { eq } from "drizzle-orm";
import { db, disabledSkills } from "../db";
import { getSkill, listSkills, type RiskLevel, type Skill } from "./loader";

export class SkillToggleError extends Error {}

/** The code-defined skill plus whether an operator has disabled it from the dashboard. */
export interface EffectiveSkill {
  name: string;
  description: string;
  risk_level: RiskLevel;
  parameters: Record<string, { type: string; required: boolean; description?: string }>;
  enabled: boolean;
}

function withEnabled(skill: Skill, enabled: boolean): EffectiveSkill {
  return {
    name: skill.name,
    description: skill.description,
    risk_level: skill.risk_level,
    parameters: skill.parameters,
    enabled,
  };
}

export async function listEffectiveSkills(): Promise<EffectiveSkill[]> {
  const rows = await db.select({ skillName: disabledSkills.skillName }).from(disabledSkills);
  const disabled = new Set(rows.map((row) => row.skillName));
  return listSkills().map((skill) => withEnabled(skill, !disabled.has(skill.name)));
}

export async function getEffectiveSkill(name: string): Promise<EffectiveSkill | null> {
  const skill = getSkill(name);
  if (!skill) return null;
  const [row] = await db.select().from(disabledSkills).where(eq(disabledSkills.skillName, name)).limit(1);
  return withEnabled(skill, !row);
}

export async function setSkillEnabled(skillName: string, enabled: boolean): Promise<EffectiveSkill> {
  const skill = getSkill(skillName);
  if (!skill) throw new SkillToggleError(`Unknown skill: ${skillName}`);

  if (enabled) {
    await db.delete(disabledSkills).where(eq(disabledSkills.skillName, skillName));
  } else {
    await db.insert(disabledSkills).values({ skillName }).onConflictDoNothing();
  }

  return withEnabled(skill, enabled);
}
