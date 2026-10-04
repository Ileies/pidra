import { eq, inArray } from "drizzle-orm";
import { db, extractions, rawItems } from "../db";
import { HttpError } from "../util/errors";
import { renderPromptText } from "./active-prompts";
import { synthesize } from "./openai";
import { DEEPEN_PROMPT } from "./prompts";
import { braveSearch } from "../search/brave";

/** A longer read of up to 10 extracted items, grounded in a news search on the first one's headline. */
export async function deepen(ids: string[]): Promise<string> {
  const rows = await db
    .select({
      id: extractions.id,
      extractedJson: extractions.extractedJson,
      sourceName: rawItems.sourceName,
      sourceType: rawItems.sourceType,
    })
    .from(extractions)
    .leftJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(inArray(extractions.id, ids));

  if (rows.length === 0) throw new HttpError("Items not found", 404);

  const top = rows[0].extractedJson as Record<string, unknown> | null;
  const topEntities = ((top?.entities ?? []) as string[]).slice(0, 3).join(" ");
  const query = [String(top?.headline ?? ""), topEntities].filter(Boolean).join(" ").slice(0, 200);

  const webResults = query
    ? (await braveSearch(query, 5, { kind: "news" })).results.map((r) => `${r.title} - ${r.description}`).join("\n")
    : "";

  const userContent = JSON.stringify({
    items: rows.map((r) => ({
      source: r.sourceName,
      source_type: r.sourceType,
      ...((r.extractedJson as object) ?? {}),
    })),
    web_search_results: webResults || null,
  });

  const { text } = await synthesize(await renderPromptText(DEEPEN_PROMPT), userContent);
  return text;
}
