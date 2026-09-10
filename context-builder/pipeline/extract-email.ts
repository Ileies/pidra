import type { EmailItem } from "../sources/email";
import { buildEmailExtractionPrompt, EMAIL_EXTRACTION_SCHEMA } from "../prompts/email-extraction";
import { logError } from "../errors";
import { extractJson } from "../../src/ai/openai";
import { stripControlChars } from "../../src/util/text";
import { addSonnetTokens } from "../progress";
import { mapPool } from "./pool";
import { db } from "../../src/db";
import { contextBuilderIndexedItems } from "../../src/db/schema";

export interface EmailExtraction {
  messageId: string;
  from: string;
  fromName: string;
  date: string;
  category: string;
  importance: string;
  summary: string;
  actionRequired: string | null;
  entities: string[];
  sentiment: string;
}

interface RawEmailExtraction {
  category: string;
  importance: string;
  summary: string;
  action_required: string | null;
  entities: string[];
  sentiment: string;
}

// Extraction runs against the hosted model on the flex tier, which handles far more parallelism
// than the local GPU did. Retries and 429 backoff live in withFlexRetry inside extractJson.
const CONCURRENCY = Number(process.env.CONTEXT_BUILDER_EXTRACT_CONCURRENCY ?? 8);

export async function extractEmails(
  emails: EmailItem[],
  runId: string,
  today: string,
  onProgress?: (done: number) => void,
): Promise<EmailExtraction[]> {
  const systemPrompt = buildEmailExtractionPrompt(today);
  const results: EmailExtraction[] = [];
  let done = 0;

  await mapPool(emails, CONCURRENCY, async (email) => {
    try {
      const content = `From: ${email.fromName} <${email.from}>\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body.slice(0, 6000)}`;
      const json = await extractJson<RawEmailExtraction>(systemPrompt, content, {
        schema: EMAIL_EXTRACTION_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
        maxOutputTokens: 2500,
        onUsage: addSonnetTokens,
      });

      const extraction: EmailExtraction = {
        messageId: email.messageId,
        from: email.from,
        fromName: email.fromName,
        date: email.date,
        category: json.category ?? "other",
        importance: json.importance ?? "low",
        summary: stripControlChars(json.summary ?? "").slice(0, 80),
        actionRequired: json.action_required ? stripControlChars(json.action_required) : null,
        entities: Array.isArray(json.entities)
          ? json.entities.slice(0, 5).map((e) => stripControlChars(String(e)))
          : [],
        sentiment: json.sentiment ?? "neutral",
      };

      results.push(extraction);

      await db.insert(contextBuilderIndexedItems).values({
        runId,
        source: "email",
        itemId: email.messageId,
        data: extraction,
      }).onConflictDoUpdate({
        target: [contextBuilderIndexedItems.source, contextBuilderIndexedItems.itemId],
        set: { runId, data: extraction },
      });
    } catch (err) {
      await logError("extract-email", err, email.messageId);
    } finally {
      done++;
      onProgress?.(done);
    }
  });

  return results;
}
