import type { EmailItem } from "../sources/email";
import { EMAIL_EXTRACTION_PROMPT } from "../prompts/email-extraction";
import { logError } from "../errors";
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

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const SEMAPHORE_LIMIT = 4;

async function extractWithOllama(model: string, content: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: EMAIL_EXTRACTION_PROMPT },
        { role: "user", content: content.slice(0, 6000) },
      ],
      stream: false,
      format: "json",
    }),
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status}`);
  const data = await res.json() as { message: { content: string } };
  return JSON.parse(data.message.content);
}

export async function extractEmails(
  emails: EmailItem[],
  runId: string,
  model: string,
  onProgress?: (done: number) => void,
): Promise<EmailExtraction[]> {
  const results: EmailExtraction[] = [];
  let active = 0;
  let done = 0;
  const queue = [...emails];

  const runOne = async (email: EmailItem): Promise<void> => {
    try {
      const content = `From: ${email.fromName} <${email.from}>\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`;
      const json = await extractWithOllama(model, content);

      const extraction: EmailExtraction = {
        messageId: email.messageId,
        from: email.from,
        fromName: email.fromName,
        date: email.date,
        category: String(json.category ?? "other"),
        importance: String(json.importance ?? "low"),
        summary: String(json.summary ?? "").slice(0, 80),
        actionRequired: json.action_required ? String(json.action_required) : null,
        entities: Array.isArray(json.entities) ? (json.entities as string[]).slice(0, 5) : [],
        sentiment: String(json.sentiment ?? "neutral"),
      };

      results.push(extraction);

      // Mark as indexed
      await db.insert(contextBuilderIndexedItems).values({
        runId,
        source: "email",
        itemId: email.messageId,
      }).onConflictDoNothing();
    } catch (err) {
      await logError("extract-email", err, email.messageId);
    } finally {
      done++;
      onProgress?.(done);
    }
  };

  // Semaphore
  const workers: Promise<void>[] = [];
  for (const email of queue) {
    while (active >= SEMAPHORE_LIMIT) {
      await Promise.race(workers);
    }
    active++;
    const p = runOne(email).finally(() => active--);
    workers.push(p);
  }
  await Promise.all(workers);

  return results;
}
