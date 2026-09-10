// See EMAIL_EXTRACTION_SCHEMA - only the fields the pipeline consumes are requested. `title`
// comes from the note envelope, not the model.
export const NOTE_EXTRACTION_SCHEMA = {
  name: "note_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["category", "summary", "entities", "type", "importance"],
    properties: {
      category: { type: "string", description: "label from the note or inferred" },
      summary: { type: "string", description: "max 80 chars - what this note is about" },
      // No `maxItems`: structured outputs accepts it and silently ignores it, so it reads as a
      // bound that does not exist. The cap is stated in the prompt and enforced in code.
      entities: {
        type: "array",
        items: { type: "string" },
        description: "at most 5 short names of people, orgs, projects or concepts mentioned",
      },
      type: {
        type: "string",
        enum: ["rule", "reminder", "idea", "list", "reference", "diary", "other"],
      },
      importance: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
} as const;

export const NOTE_EXTRACTION_PROMPT = `Extract key information from this Google Keep note into the required JSON schema.

Rules:
- If the note is a rule/habit (e.g. "always do X"), type = rule and importance = high
- If it mentions people by name, include them in entities
- entities: AT MOST 5, each a short proper name of two to five words. Never a sentence, never a
  list packed into one string, never your own commentary. Omit rather than pad the array.
- summary: max 80 chars, specific rather than generic`;
