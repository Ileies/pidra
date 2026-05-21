import { readdirSync } from "fs";
import { join } from "path";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface SkillParam {
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}

export interface Skill {
  name: string;
  description: string;
  risk_level: RiskLevel;
  parameters: Record<string, SkillParam>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

const registry = new Map<string, Skill>();

export async function loadSkills(): Promise<void> {
  const skillsDir = join(import.meta.dir, "../../skills");
  let files: string[];
  try {
    files = readdirSync(skillsDir).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
  } catch {
    console.warn("[Skills] skills/ directory not found or empty");
    return;
  }

  for (const file of files) {
    try {
      const mod = await import(join(skillsDir, file));
      const skill: Skill = mod.default;
      if (!skill?.name || !skill?.execute) {
        console.warn(`[Skills] ${file} has no valid default export - skipped`);
        continue;
      }
      registry.set(skill.name, skill);
      console.log(`[Skills] Loaded: ${skill.name} (${skill.risk_level})`);
    } catch (err) {
      console.error(`[Skills] Failed to load ${file}:`, err);
    }
  }
  console.log(`[Skills] ${registry.size} skill(s) registered`);
}

export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): Skill[] {
  return [...registry.values()];
}
