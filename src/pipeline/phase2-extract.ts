import { db, rawItems, extractions } from "../db";
import { extractJson } from "../ai/openai";
import { NEWSLETTER_EXTRACTION_PROMPT, ENTITY_EXTRACTION_PROMPT, PERSONAL_EMAIL_PROMPT } from "../ai/prompts";
import { eq } from "drizzle-orm";

const CONCURRENCY = 4;

interface NewsletterExtraction {
  source: string;
  date: string;
  items: {
    headline: string;
    topic_tags: string[];
    key_claim: string;
    entities: string[];
    relevance_score: number;
  }[];
  skip_reason: string | null;
}

interface EntityExtraction {
  entities: { name: string; aliases: string[]; type: string; domain: string }[];
  relations: { from: string; to: string; type: string; confidence: number }[];
}

interface PersonalEmailClassification {
  type: string;
  urgency: string;
  deadline: string | null;
  action_required: string | null;
  unknown_context: boolean;
  question_for_user: string | null;
  sender_known: boolean;
  calendar_event_suggested: boolean;
  todo_suggested: boolean;
}

async function extractItem(item: typeof rawItems.$inferSelect): Promise<void> {
  try {
    if (item.sourceType === "newsletter") {
      const [newsletterData, entityData] = await Promise.all([
        extractJson<NewsletterExtraction>(NEWSLETTER_EXTRACTION_PROMPT, item.rawContent ?? ""),
        extractJson<EntityExtraction>(ENTITY_EXTRACTION_PROMPT, item.rawContent ?? ""),
      ]);

      for (const extracted of newsletterData.items) {
        await db.insert(extractions).values({
          rawItemId: item.id,
          runDate: item.runDate,
          extractedJson: { ...extracted, entities_graph: entityData },
          relevanceScore: extracted.relevance_score,
          effectiveRelevance: extracted.relevance_score, // corroboration bonus applied in phase3
          novelty: "new",
          includedInReport: false,
          aiFailed: false,
        });
      }

      if (newsletterData.items.length === 0) {
        await db.insert(extractions).values({
          rawItemId: item.id,
          runDate: item.runDate,
          extractedJson: { skip_reason: newsletterData.skip_reason },
          relevanceScore: 0,
          effectiveRelevance: 0,
          novelty: "new",
          includedInReport: false,
          aiFailed: false,
        });
      }
    } else if (item.sourceType === "personal_email" || item.sourceType === "sms") {
      const classification = await extractJson<PersonalEmailClassification>(
        PERSONAL_EMAIL_PROMPT,
        item.rawContent ?? ""
      );

      await db.insert(extractions).values({
        rawItemId: item.id,
        runDate: item.runDate,
        extractedJson: classification,
        relevanceScore: classification.urgency === "critical" ? 5 : classification.urgency === "high" ? 4 : 3,
        effectiveRelevance: classification.urgency === "critical" ? 5 : classification.urgency === "high" ? 4 : 3,
        novelty: "new",
        unknownContext: classification.unknown_context,
        questionForUser: classification.question_for_user,
        includedInReport: false,
        aiFailed: false,
      });
    }
  } catch (err) {
    console.error(`Extraction failed for item ${item.id}:`, err);
    await db.insert(extractions).values({
      rawItemId: item.id,
      runDate: item.runDate,
      extractedJson: null,
      relevanceScore: null,
      effectiveRelevance: null,
      novelty: "new",
      aiFailed: true,
    });
  }
}

export async function runPhase2(runDate: string): Promise<void> {
  console.log(`[Phase 2] Starting extraction for ${runDate}`);

  const items = await db.select().from(rawItems).where(eq(rawItems.runDate, runDate));
  console.log(`[Phase 2] ${items.length} items to extract`);

  // Semaphore: max CONCURRENCY concurrent calls
  const queue = [...items];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await extractItem(item);
    }
  });

  await Promise.allSettled(workers);
  console.log(`[Phase 2] Extraction complete`);
}
