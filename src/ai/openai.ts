import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EXTRACTION_MODEL = process.env.OPENAI_MODEL_EXTRACTION ?? "gpt-4o";
export const SYNTHESIS_MODEL = process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-4o";

export async function extractJson<T>(systemPrompt: string, userContent: string): Promise<T> {
  const response = await openai.responses.create({
    model: EXTRACTION_MODEL,
    store: false,
    instructions: systemPrompt,
    input: `Return JSON only.\n\n${userContent}`,
    temperature: 0,
    text: { format: { type: "json_object" } },
  });

  const content = response.output_text;
  if (!content) throw new Error("Empty response from OpenAI extraction");
  return JSON.parse(content) as T;
}

export async function synthesize(systemPrompt: string, userContent: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const response = await openai.responses.create({
    model: SYNTHESIS_MODEL,
    store: false,
    instructions: systemPrompt,
    input: userContent,
    temperature: 0.3,
    max_output_tokens: 2048,
  });

  return {
    text: response.output_text,
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
  };
}
