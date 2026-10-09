/**
 * Entity enrichment, run after the report is written: an agent places entities the graph keeps
 * citing without a description, from the mentions, the long-term context and web search, and is
 * the only author of questions about entities. Replaces the old fixed-template candidate source.
 * Never throws; a failed entity is simply tried again on a later run.
 */
import { and, desc, eq, inArray, or, isNull, sql as drizzleSql } from "drizzle-orm";
import { converse, usageTally, type FunctionTool, type ResponseInput } from "../ai/openai";
import { activePrompt } from "../ai/active-prompts";
import { db, entities, entityMentions, extractions, rawItems } from "../db";
import { braveSearch } from "../search/brave";
import { closeEntityQuestions, raiseEntityQuestion, settledEntityIds } from "../questions/store";
import { errMessage, squash } from "../util/text";
import { loadLongTermContext, type LongTermContext } from "./long-term-context";

const MIN_MENTIONS = 3;
const MAX_PER_RUN = 5;
const MAX_ROUNDS = 6;
const MENTION_LIMIT = 8;
const ENTITY_TYPES = ["person", "org", "tech", "law", "event", "concept", "place"];

type Entity = { id: string; name: string; mentionCount: number | null; firstSeen: string | null; type: string | null };
type Verdict = { kind: "recorded" | "asked" | "gave_up" | "other"; detail: string };

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): FunctionTool => ({
  type: "function", name, description, strict: false,
  parameters: { type: "object", properties, required, additionalProperties: false },
});

const TOOLS: FunctionTool[] = [
  tool("read_mentions", "The claims from the reader's sources that mention this entity.", {}, []),
  tool("search_web", "Web search for what the entity is.", { query: { type: "string" } }, ["query"]),
  tool("record_entity", "Store what the entity is. Ends the job.", {
    type: { type: "string", enum: ENTITY_TYPES },
    domain: { type: "string" },
    summary: { type: "string" },
  }, ["type", "domain", "summary"]),
  tool("ask_reader", "Ask the reader one question about this entity. Ends the job.", { question: { type: "string" }, why: { type: "string" } }, ["question", "why"]),
  tool("give_up", "Nothing placeable and nothing worth asking. Ends the job.", { reason: { type: "string" } }, ["reason"]),
];

/** Entities cited often enough to matter, still without a description, never looked at before, most cited first. */
export async function enrichmentCandidates(limit = MAX_PER_RUN): Promise<Entity[]> {
  const settled = await settledEntityIds();
  const rows = await db
    .select({ id: entities.id, name: entities.name, mentionCount: entities.mentionCount, firstSeen: entities.firstSeen, type: entities.type })
    .from(entities)
    .where(and(
      inArray(entities.status, ["active", "dormant"]),
      drizzleSql`${entities.locked} IS NOT TRUE`,
      drizzleSql`COALESCE(${entities.mentionCount}, 0) >= ${MIN_MENTIONS}`,
      or(isNull(entities.summary), eq(entities.summary, "")),
    ))
    .orderBy(desc(entities.mentionCount));
  return rows.filter((e) => !settled.has(e.id)).slice(0, limit);
}

/** What the sources say about the entity, newest first: the claims that name it. */
async function mentionClaims(entity: Entity): Promise<string[]> {
  const refs = await db.select({ ref: entityMentions.sourceRef }).from(entityMentions).where(eq(entityMentions.entityId, entity.id)).limit(40);
  if (refs.length === 0) return [];
  const rows = await db
    .select({ source: rawItems.sourceName, claim: drizzleSql<string | null>`${extractions.extractedJson} ->> 'key_claim'` })
    .from(extractions)
    .innerJoin(rawItems, eq(rawItems.id, extractions.rawItemId))
    .where(and(
      inArray(extractions.rawItemId, refs.map((r) => r.ref)),
      drizzleSql`${extractions.extractedJson} ->> 'key_claim' ILIKE ${"%" + entity.name + "%"}`,
    ))
    .orderBy(desc(extractions.runDate))
    .limit(MENTION_LIMIT);
  return rows.filter((r) => r.claim).map((r) => `[${r.source ?? "source"}] ${squash(r.claim, 300)}`);
}

async function searchWeb(query: string): Promise<string> {
  try {
    const { results } = await braveSearch(query, 5, { freshness: "any" });
    return results.length === 0 ? "No results." : results.map((r) => `${r.title}: ${squash(r.description, 240)}`).join("\n");
  } catch (err) {
    return `Search unavailable (${errMessage(err)}). Rely on the mentions and the context.`;
  }
}

/** One agent pass over one entity. The terminal tool's effect is applied here, not by the model. */
async function enrichOne(entity: Entity, context: LongTermContext, today: string, instructions: string, onUsage: (i: number, o: number) => void): Promise<Verdict> {
  const input: ResponseInput = [{
    role: "user",
    content: JSON.stringify({
      entity: { name: entity.name, mentions: entity.mentionCount, first_seen: entity.firstSeen, type: entity.type },
      long_term_context: context.personalSections || null,
      context_corrections: context.corrections.length > 0 ? context.corrections.map((c) => JSON.stringify(c)).join("\n") : null,
    }),
  }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const turn = await converse(instructions, input, { tools: TOOLS, onUsage, reasoningEffort: "low" });
    if (turn.functionCalls.length === 0) return { kind: "other", detail: "the agent ended without a decision" };
    input.push(...turn.output);

    for (const call of turn.functionCalls) {
      let args: Record<string, string> = {};
      try { args = JSON.parse(call.argumentsJson || "{}"); } catch { /* an unparseable call is answered below */ }

      if (call.name === "record_entity") {
        const summary = squash(args.summary, 400);
        if (!summary) { input.push({ type: "function_call_output", call_id: call.callId, output: "A summary is required." }); continue; }
        const type = ENTITY_TYPES.includes(args.type) ? args.type : entity.type;
        await db.update(entities).set({ type, domain: squash(args.domain, 60) || null, summary }).where(and(eq(entities.id, entity.id), drizzleSql`${entities.locked} IS NOT TRUE`));
        await closeEntityQuestions(entity.id, `The entity enrichment agent described it: ${summary}`);
        return { kind: "recorded", detail: summary };
      }
      if (call.name === "ask_reader") {
        const outcome = await raiseEntityQuestion(entity, args.question, args.why ?? "", today);
        return { kind: "asked", detail: outcome };
      }
      if (call.name === "give_up") {
        await raiseEntityQuestion(entity, null, args.reason ?? "nothing placeable", today);
        return { kind: "gave_up", detail: args.reason ?? "" };
      }

      const output = call.name === "read_mentions"
        ? (await mentionClaims(entity)).join("\n") || "No claim mentions it by name."
        : call.name === "search_web" ? await searchWeb(squash(args.query, 200)) : `Unknown tool ${call.name}.`;
      input.push({ type: "function_call_output", call_id: call.callId, output });
    }
  }
  return { kind: "other", detail: "no decision within the round limit" };
}

export interface EnrichmentResult { enriched: number; asked: number; gaveUp: number; tokensIn: number; tokensOut: number }

/** The pipeline's step, after the report: at most `MAX_PER_RUN` entities, one failure never stops the rest. */
export async function runEntityEnrichment(today: string, longTermContext?: LongTermContext): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { enriched: 0, asked: 0, gaveUp: 0, tokensIn: 0, tokensOut: 0 };
  const candidates = await enrichmentCandidates();
  if (candidates.length === 0) return result;

  const context = longTermContext ?? (await loadLongTermContext());
  const instructions = (await activePrompt("entity_enrichment")).text;
  const tally = usageTally();

  for (const entity of candidates) {
    try {
      const verdict = await enrichOne(entity, context, today, instructions, tally.onUsage);
      if (verdict.kind === "recorded") result.enriched++;
      else if (verdict.kind === "asked") result.asked++;
      else if (verdict.kind === "gave_up") result.gaveUp++;
      console.log(`[Enrichment] ${entity.name}: ${verdict.kind} - ${squash(verdict.detail, 120)}`);
    } catch (err) {
      console.error(`[Enrichment] ${entity.name} failed, it is tried again on a later run:`, err);
    }
  }
  return { ...result, tokensIn: tally.tokensIn, tokensOut: tally.tokensOut };
}
