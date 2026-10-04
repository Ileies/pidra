// Model ids, kept free of the OpenAI client so the context builder can share them.
export const EXTRACTION_MODEL = process.env.OPENAI_MODEL_EXTRACTION ?? "gpt-6-luna";
export const SYNTHESIS_MODEL = process.env.OPENAI_MODEL_SYNTHESIS ?? "gpt-6-luna";
