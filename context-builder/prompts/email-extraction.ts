// Strict JSON schema handed to the model alongside the prompt. Only the fields the pipeline
// actually consumes are requested - echoing back sender/subject/date the caller already has
// just burns output tokens and gives the model room to disagree with the envelope.
export const EMAIL_EXTRACTION_SCHEMA = {
  name: "email_extraction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["category", "importance", "summary", "action_required", "entities", "sentiment"],
    properties: {
      category: {
        type: "string",
        enum: ["work", "personal", "financial", "service", "automated", "spam"],
      },
      importance: { type: "string", enum: ["high", "medium", "low"] },
      summary: { type: "string", description: "max 60 chars - what the email is about" },
      action_required: {
        type: ["string", "null"],
        description: "what the user needs to do, if anything",
      },
      // No `maxItems`: structured outputs accepts it and silently ignores it, so it reads as a
      // bound that does not exist. The cap is stated in the prompt and enforced in code.
      entities: {
        type: "array",
        items: { type: "string" },
        description: "at most 5 first names or org names of people, orgs, projects mentioned",
      },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
    },
  },
} as const;

export function buildEmailExtractionPrompt(today: string): string {
  return `Today's date is ${today}. Extract key information from this email into the required JSON schema.

Rules:
- summary: be specific, not generic ("Invoice #1234 from Acme" not "an invoice"), max 60 chars
- action_required: null if the deadline or action has clearly already passed relative to today's date, or if no action was ever needed
- importance: weigh against how old the email is relative to today - a time-bound request or deadline from months or years ago is no longer high importance just because it once was, unless it describes a recurring or still-ongoing situation
- entities: AT MOST 5, each a short proper name of two to five words. Never a sentence, never a
  list packed into one string, never your own commentary. Omit rather than pad the array.`;
}
