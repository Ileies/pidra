import type { KeepNote } from "../sources/keep";
import { NOTE_EXTRACTION_PROMPT } from "../prompts/note-extraction";
import { logError } from "../errors";
import { db } from "../../src/db";
import { contextBuilderIndexedItems } from "../../src/db/schema";

export interface NoteExtraction {
  id: string;
  title: string;
  labels: string[];
  category: string;
  summary: string;
  entities: string[];
  type: string;
  importance: string;
  rawText: string;
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
        { role: "system", content: NOTE_EXTRACTION_PROMPT },
        { role: "user", content: content.slice(0, 3000) },
      ],
      stream: false,
      format: "json",
    }),
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status}`);
  const data = await res.json() as { message: { content: string } };
  return JSON.parse(data.message.content);
}

export async function extractNotes(
  notes: KeepNote[],
  runId: string,
  model: string,
  skipIds: Set<string>,
  onProgress?: (done: number) => void,
): Promise<NoteExtraction[]> {
  const results: NoteExtraction[] = [];
  let active = 0;
  let done = 0;
  const toProcess = notes.filter((n) => !skipIds.has(n.id));

  const runOne = async (note: KeepNote): Promise<void> => {
    try {
      const content = `Title: ${note.title}\nLabels: ${note.labels.join(", ")}\n\n${note.text}`;
      const json = await extractWithOllama(model, content);

      results.push({
        id: note.id,
        title: note.title,
        labels: note.labels,
        category: String(json.category ?? note.labels[0] ?? "general"),
        summary: String(json.summary ?? "").slice(0, 80),
        entities: Array.isArray(json.entities) ? (json.entities as string[]).slice(0, 5) : [],
        type: String(json.type ?? "other"),
        importance: String(json.importance ?? "medium"),
        rawText: note.text.slice(0, 200),
      });

      await db.insert(contextBuilderIndexedItems).values({
        runId,
        source: "keep",
        itemId: note.id,
      }).onConflictDoNothing();
    } catch (err) {
      await logError("extract-note", err, note.id);
    } finally {
      done++;
      onProgress?.(done);
    }
  };

  const workers: Promise<void>[] = [];
  for (const note of toProcess) {
    while (active >= SEMAPHORE_LIMIT) {
      await Promise.race(workers);
    }
    active++;
    const p = runOne(note).finally(() => active--);
    workers.push(p);
  }
  await Promise.all(workers);

  return results;
}
