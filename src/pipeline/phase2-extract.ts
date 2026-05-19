import { db, rawItems, extractions, sourceQuality } from "../db";
import { extractJson } from "../ai/openai";
import { NEWSLETTER_EXTRACTION_PROMPT, ENTITY_EXTRACTION_PROMPT, buildPersonalEmailPrompt } from "../ai/prompts";
import { loadEmailAccounts } from "../config/email-accounts";
import { emailEffectiveRelevance } from "./email-category";
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
  email_category: "personal_important" | "general_news" | "automated" | "spam";
  urgency: string;
  deadline: string | null;
  action_required: string | null;
  unknown_context: boolean;
  question_for_user: string | null;
  sender_known: boolean;
  calendar_event_suggested: boolean;
  todo_suggested: boolean;
}

async function extractItem(
  item: typeof rawItems.$inferSelect,
  runDate: string,
  accountCustomInstructions: string | null
): Promise<void> {
  try {
    if (item.sourceType === "newsletter") {
      const [newsletterData, entityData] = await Promise.all([
        extractJson<NewsletterExtraction>(NEWSLETTER_EXTRACTION_PROMPT, item.rawContent ?? ""),
        extractJson<EntityExtraction>(ENTITY_EXTRACTION_PROMPT, item.rawContent ?? ""),
      ]);

      for (const extracted of newsletterData.items) {
        await db.insert(extractions).values({
          rawItemId: item.id,
          runDate,
          extractedJson: { ...extracted, entities_graph: entityData },
          relevanceScore: extracted.relevance_score,
          effectiveRelevance: extracted.relevance_score,
          novelty: "new",
          includedInReport: false,
          aiFailed: false,
        });
      }

      if (newsletterData.items.length === 0) {
        await db.insert(extractions).values({
          rawItemId: item.id,
          runDate,
          extractedJson: { skip_reason: newsletterData.skip_reason },
          relevanceScore: 0,
          effectiveRelevance: 0,
          novelty: "new",
          includedInReport: false,
          aiFailed: false,
        });
      }
    } else if (item.sourceType === "personal_email" || item.sourceType === "sms") {
      const prompt = buildPersonalEmailPrompt(accountCustomInstructions);
      const classification = await extractJson<PersonalEmailClassification>(
        prompt,
        item.rawContent ?? ""
      );

      const effectiveRelevance = emailEffectiveRelevance(classification.email_category, classification.urgency);

      await db.insert(extractions).values({
        rawItemId: item.id,
        runDate,
        extractedJson: classification,
        relevanceScore: effectiveRelevance,
        effectiveRelevance,
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
      runDate,
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

  const accounts = loadEmailAccounts();
  const accountMap = new Map(accounts.map((a) => [a.user, a]));

  const disabledRows = await db
    .select({ sourceName: sourceQuality.sourceName })
    .from(sourceQuality)
    .where(eq(sourceQuality.isActive, false));
  const disabledSources = new Set(disabledRows.map((r) => r.sourceName));

  const items = await db.select().from(rawItems).where(eq(rawItems.runDate, runDate));
  const activeItems = items.filter((item) => !item.sourceName || !disabledSources.has(item.sourceName));
  const skipped = items.length - activeItems.length;
  if (skipped > 0) console.log(`[Phase 2] Skipping ${skipped} items from disabled sources`);
  console.log(`[Phase 2] ${activeItems.length} items to extract`);

  const queue = [...activeItems];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const account = item.accountId ? accountMap.get(item.accountId) : null;
      const customInstructions = account?.customInstructions ?? null;
      await extractItem(item, runDate, customInstructions);
    }
  });

  await Promise.allSettled(workers);
  console.log(`[Phase 2] Extraction complete`);
}
