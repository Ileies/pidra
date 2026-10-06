/**
 * Resolves a Jev question rubric from the approved prompt catalog (`jev_*` sections). An approved
 * version that does not parse is ignored with a warning, so a bad edit cannot break a decision call;
 * the code baseline answers instead. `rubricVersion` is what the ledger records.
 */
import { baseline, type PromptSection } from "./prompt-catalog";
import { resolveActivePrompts } from "./active-prompts";

export type JevRubricSection = Extract<PromptSection, `jev_${string}`>;

export interface JevRubric {
  question: string;
  /** Ordered Score levels, lowest first. */
  criteria: string[];
  /** `code` for the baseline, `v<n>` for an approved prompt version. */
  rubricVersion: string;
}

/** Null unless the text is a JSON object with a question and at least two non-empty levels. */
export function parseJevRubric(text: string): Pick<JevRubric, "question" | "criteria"> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { question, criteria } = value as Record<string, unknown>;
  if (typeof question !== "string" || question.trim() === "") return null;
  if (!Array.isArray(criteria) || criteria.length < 2) return null;
  if (!criteria.every((level) => typeof level === "string" && level.trim() !== "")) return null;
  return { question: question.trim(), criteria: criteria.map((level) => (level as string).trim()) };
}

export async function activeJevRubric(section: JevRubricSection): Promise<JevRubric> {
  const effective = (await resolveActivePrompts())[section];
  const parsed = parseJevRubric(effective.text);
  if (parsed) return { ...parsed, rubricVersion: effective.source === "db" ? `v${effective.version}` : "code" };
  console.warn(`[jev] ${section} v${effective.version} does not parse as a rubric, using the code baseline`);
  const fallback = parseJevRubric(baseline(section).text);
  if (!fallback) throw new Error(`code baseline for ${section} is not a valid rubric`);
  return { ...fallback, rubricVersion: "code" };
}
