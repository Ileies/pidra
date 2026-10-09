import {
  ANSWER_CLASSIFICATION_PROMPT,
  ENTITY_ENRICHMENT_PROMPT,
  ENTITY_EXTRACTION_PROMPT,
  JEV_NEWS_IMPACT_PROMPT,
  JEV_NEWS_NOVELTY_PROMPT,
  NEWS_BEAT_PROMPT,
  NEWS_FIELD_PROMPT,
  NEWS_HOME_PROMPT,
  NEWS_SECTION_PROMPT,
  NEWS_SERENDIPITY_PROMPT,
  NEWS_TALK_PROMPT,
  NEWS_WORLD_PROMPT,
  NEWSLETTER_EXTRACTION_PROMPT,
  PERSONAL_EMAIL_PROMPT,
  QUESTIONS_PROMPT,
  QUICK_ACTIONS_PROMPT,
  SECTION1_SYSTEM_PROMPT,
  SECTION2_SYSTEM_PROMPT,
} from "./prompts";

/** The sections the pipeline reads, in the display order used by the dashboard. */
export const PROMPT_SECTIONS = [
  "section1",
  "section2",
  "news",
  "quick_actions",
  "questions",
  "answer_classification",
  "extraction",
  "entity_extraction",
  "entity_enrichment",
  "personal_classification",
  "news_world",
  "news_home",
  "news_beat",
  "news_field",
  "news_talk",
  "news_serendipity",
  "jev_news_impact",
  "jev_news_novelty",
] as const;

export type PromptSection = (typeof PROMPT_SECTIONS)[number];

/**
 * Sections whose output the reader reads, so their prompt must carry `{{language}}`. The rest
 * stay English by design: extraction compresses raw content into the structure the pipeline
 * matches on (entities, topics, dedupe), the news desks research in English and the editor writes
 * the section, and the answer classification only feeds a label into the sender directory.
 */
export const LANGUAGE_SECTIONS: readonly PromptSection[] = ["section1", "section2", "news", "quick_actions", "questions", "entity_enrichment"];

const BASELINES: Record<PromptSection, string> = {
  section1: SECTION1_SYSTEM_PROMPT,
  section2: SECTION2_SYSTEM_PROMPT,
  news: NEWS_SECTION_PROMPT,
  quick_actions: QUICK_ACTIONS_PROMPT,
  questions: QUESTIONS_PROMPT,
  answer_classification: ANSWER_CLASSIFICATION_PROMPT,
  extraction: NEWSLETTER_EXTRACTION_PROMPT,
  entity_extraction: ENTITY_EXTRACTION_PROMPT,
  entity_enrichment: ENTITY_ENRICHMENT_PROMPT,
  personal_classification: PERSONAL_EMAIL_PROMPT,
  news_world: NEWS_WORLD_PROMPT,
  news_home: NEWS_HOME_PROMPT,
  news_beat: NEWS_BEAT_PROMPT,
  news_field: NEWS_FIELD_PROMPT,
  news_talk: NEWS_TALK_PROMPT,
  news_serendipity: NEWS_SERENDIPITY_PROMPT,
  jev_news_impact: JEV_NEWS_IMPACT_PROMPT,
  jev_news_novelty: JEV_NEWS_NOVELTY_PROMPT,
};

export interface EffectivePrompt {
  section: PromptSection;
  text: string;
  version: number | null;
  source: "db" | "code";
}

export function baseline(section: PromptSection): EffectivePrompt {
  return { section, text: BASELINES[section], version: null, source: "code" };
}

/** Resolve the same code baseline and active DB overrides in both processes. */
export function resolvePromptRows(
  rows: ReadonlyArray<{ section: string; version: number; promptText: string }>,
): Record<PromptSection, EffectivePrompt> {
  const resolved = Object.fromEntries(
    PROMPT_SECTIONS.map((section) => [section, baseline(section)]),
  ) as Record<PromptSection, EffectivePrompt>;

  for (const row of rows) {
    if (!(row.section in resolved)) continue;
    const section = row.section as PromptSection;
    resolved[section] = { section, text: row.promptText, version: row.version, source: "db" };
  }

  return resolved;
}
