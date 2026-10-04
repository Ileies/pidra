import { sql } from "drizzle-orm";
import { contacts, db } from "../db";
import { activePrompt } from "../ai/active-prompts";
import { extractJson } from "../ai/openai";

interface AnswerClassification {
  /** "" when the answer gives no standing relationship to record. */
  relationship: string;
  spam_or_irrelevant: boolean;
}

const ANSWER_CLASSIFICATION_SCHEMA = {
  name: "answer_classification",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relationship", "spam_or_irrelevant"],
    properties: {
      relationship: { type: "string" },
      spam_or_irrelevant: { type: "boolean" },
    },
  },
};

/**
 * Teaches the sender directory from an answer about one sender - only the standing relationship the
 * answer actually gives, never the answer text verbatim, so "no idea, looks like spam" cannot become
 * that sender's permanent description. A row a correction has locked is left alone: the reader's
 * correction outranks a quick answer. A failure here never loses the answer, which is already recorded.
 */
export async function teachContact(identifier: string, answer: string, firstSeen: string): Promise<void> {
  let classification: AnswerClassification;
  try {
    const prompt = await activePrompt("answer_classification");
    classification = await extractJson<AnswerClassification>(prompt.text, answer, {
      schema: ANSWER_CLASSIFICATION_SCHEMA,
      reasoningEffort: "low",
    });
  } catch (err) {
    console.error(`[questions] Answer classification failed for ${identifier}, leaving contacts untouched:`, err);
    return;
  }

  const relationship = classification.relationship.trim();
  if (classification.spam_or_irrelevant || !relationship) return;

  await db
    .insert(contacts)
    .values({ identifier, relationship, firstSeen })
    .onConflictDoUpdate({
      target: contacts.identifier,
      set: { relationship, updatedAt: sql`now()` },
      setWhere: sql`${contacts.locked} IS NOT TRUE`,
    });
}
