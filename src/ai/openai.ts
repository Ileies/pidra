import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EXTRACTION_MODEL = process.env.OPENAI_MODEL_EXTRACTION ?? "gpt-4o";
export const SYNTHESIS_MODEL = process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-4o";

export async function extractJson<T>(systemPrompt: string, userContent: string): Promise<T> {
  const response = await openai.chat.completions.create({
    model: EXTRACTION_MODEL,
    store: false,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty response from OpenAI extraction");
  return JSON.parse(content) as T;
}

export async function synthesize(systemPrompt: string, userContent: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const response = await openai.chat.completions.create({
    model: SYNTHESIS_MODEL,
    store: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    max_completion_tokens: 2048,
  });

  const text = response.choices[0].message.content ?? "";
  return {
    text,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
  };
}
