import type { KeepNote } from "../sources/keep";
import { NOTE_EXTRACTION_PROMPT, NOTE_EXTRACTION_SCHEMA } from "../prompts/note-extraction";
import { logError } from "../errors";
import { extractJson } from "../../src/ai/openai";
import { stripControlChars } from "../../src/util/text";
import { addSonnetTokens } from "../progress";
import { mapPool } from "./pool";
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

interface RawNoteExtraction {
  category: string;
  summary: string;
  entities: string[];
  type: string;
  importance: string;
}

const CONCURRENCY = Number(process.env.CONTEXT_BUILDER_EXTRACT_CONCURRENCY ?? 8);

export async function extractNotes(
  notes: KeepNote[],
  runId: string,
  skipIds: Set<string>,
  onProgress?: (done: number) => void,
): Promise<NoteExtraction[]> {
  const results: NoteExtraction[] = [];
  let done = 0;
  const toProcess = notes.filter((n) => !skipIds.has(n.id));

  await mapPool(toProcess, CONCURRENCY, async (note) => {
    try {
      const content = `Title: ${note.title}\nLabels: ${note.labels.join(", ")}\n\n${note.text.slice(0, 3000)}`;
      const json = await extractJson<RawNoteExtraction>(NOTE_EXTRACTION_PROMPT, content, {
        schema: NOTE_EXTRACTION_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
        // Long list-style notes exhausted a 1200 cap and failed as "incomplete".
        maxOutputTokens: 4000,
        onUsage: addSonnetTokens,
      });

      const extraction: NoteExtraction = {
        id: note.id,
        title: note.title,
        labels: note.labels,
        category: stripControlChars(json.category || note.labels[0] || "general"),
        summary: stripControlChars(json.summary ?? "").slice(0, 80),
        entities: Array.isArray(json.entities)
          ? json.entities.slice(0, 5).map((e) => stripControlChars(String(e)))
          : [],
        type: json.type ?? "other",
        importance: json.importance ?? "medium",
        // Kept generous: the Keep synthesis feeds this verbatim to the model, and the whole
        // point of the context document is to be thorough about the user's own notes.
        rawText: note.text.slice(0, 600),
      };
      results.push(extraction);

      await db.insert(contextBuilderIndexedItems).values({
        runId,
        source: "keep",
        itemId: note.id,
        data: extraction,
      }).onConflictDoUpdate({
        target: [contextBuilderIndexedItems.source, contextBuilderIndexedItems.itemId],
        set: { runId, data: extraction },
      });
    } catch (err) {
      await logError("extract-note", err, note.id);
    } finally {
      done++;
      onProgress?.(done);
    }
  });

  return results;
}
