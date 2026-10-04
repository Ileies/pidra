import { HttpError } from "../util/errors";
import { eq } from "drizzle-orm";
import { db, disabledSkills, enabledSkills } from "../db";
import { getSkill, listSkills, type Skill } from "./loader";

export class SkillToggleError extends HttpError {}

/** The code-defined skill plus whether it is switched on, per its default and the owner's toggle on /skills. */
export type EffectiveSkill = Pick<Skill, "name" | "description" | "risk_level" | "parameters"> & {
  enabled: boolean;
  /** What `enabled` is before the owner touches the switch. */
  default_enabled: boolean;
};

function isOffByDefault(skill: Skill): boolean {
  return skill.default_enabled === false;
}

function withEnabled(skill: Skill, enabled: boolean): EffectiveSkill {
  return {
    name: skill.name,
    description: skill.description,
    risk_level: skill.risk_level,
    parameters: skill.parameters,
    enabled,
    default_enabled: !isOffByDefault(skill),
  };
}

export async function listEffectiveSkills(): Promise<EffectiveSkill[]> {
  const [disabledRows, enabledRows] = await Promise.all([
    db.select({ skillName: disabledSkills.skillName }).from(disabledSkills),
    db.select({ skillName: enabledSkills.skillName }).from(enabledSkills),
  ]);
  const disabled = new Set(disabledRows.map((row) => row.skillName));
  const optedIn = new Set(enabledRows.map((row) => row.skillName));
  return listSkills().map((skill) =>
    withEnabled(skill, isOffByDefault(skill) ? optedIn.has(skill.name) : !disabled.has(skill.name)),
  );
}

export async function getEffectiveSkill(name: string): Promise<EffectiveSkill | null> {
  const skill = getSkill(name);
  if (!skill) return null;
  if (isOffByDefault(skill)) {
    const [row] = await db.select().from(enabledSkills).where(eq(enabledSkills.skillName, name)).limit(1);
    return withEnabled(skill, !!row);
  }
  const [row] = await db.select().from(disabledSkills).where(eq(disabledSkills.skillName, name)).limit(1);
  return withEnabled(skill, !row);
}

export async function setSkillEnabled(skillName: string, enabled: boolean): Promise<EffectiveSkill> {
  const skill = getSkill(skillName);
  if (!skill) throw new SkillToggleError(`Unknown skill: ${skillName}`);

  if (isOffByDefault(skill)) {
    if (enabled) {
      await db.insert(enabledSkills).values({ skillName }).onConflictDoNothing();
    } else {
      await db.delete(enabledSkills).where(eq(enabledSkills.skillName, skillName));
    }
  } else if (enabled) {
    await db.delete(disabledSkills).where(eq(disabledSkills.skillName, skillName));
  } else {
    await db.insert(disabledSkills).values({ skillName }).onConflictDoNothing();
  }

  return withEnabled(skill, enabled);
}
