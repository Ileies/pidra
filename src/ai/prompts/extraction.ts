export const NEWSLETTER_EXTRACTION_PROMPT = `You are a structured data extractor. Read the newsletter email below and return ONLY valid JSON. No preamble, no markdown, no explanation.

{
  "source": "newsletter name inferred from content",
  "date": "ISO date from email headers",
  "items": [
    {
      "headline": "one sentence, max 15 words",
      "topic_tags": ["tag1", "tag2"],
      "key_claim": "the specific claim or finding, 2 sentences max",
      "entities": ["specific named persons, orgs, technologies, places, laws - never a domain label"],
      "relevance_score": "1-5, see rubric below"
    }
  ],
  "skip_reason": null
}

Rules:
- relevance_score: use the full 1-5 range, don't default to the middle. 5 = major breakthrough or directly actionable; 4 = significant development in a priority domain, or corroborated by multiple sources; 3 = solid but incremental or narrow; 2 = tangential or a minor repeat of something already known; 1 = routine/low-signal
- entities must be specific and named, e.g. "OpenAI" or "Xi Jinping" - never a bare domain word like "AI" or "China" (that belongs in topic_tags, not entities)
- If the entire email is promotional, automated notification, or has no informational content, set items:[] and skip_reason:"promotional"
- Extract every distinct claim as a separate item, even if there are 10+
- topic_tags must be from: AI, China, Geopolitics, Finance, Science, BCI, Dev, Health, Startups, VC, EU, Switzerland, Energy, Philosophy, Security. Pick the closest fit if nothing matches exactly (e.g. climate news -> Science or Energy) - never invent a new tag`;

export const ENTITY_EXTRACTION_PROMPT = `Extract named entities from the text below. Return ONLY valid JSON.

{
  "entities": [
    {
      "name": "canonical name",
      "aliases": [],
      "type": "person|org|tech|law|event|concept|place",
      "domain": "primary domain"
    }
  ]
}

Only named entities - no generic terms.`;

export const PERSONAL_EMAIL_PROMPT = `Classify this email. Return ONLY valid JSON.

{
  "type": "invoice|invitation|reply_needed|automated|spam|personal|legal|unknown",
  "email_category": "personal_important|general_news|automated|spam",
  "urgency": "critical|high|normal|low",
  "deadline": "ISO date or null",
  "action_required": "one sentence describing required action, or null",
  "unknown_context": false,
  "question_for_user": "specific question about missing context, or null",
  "sender_known": false,
  "calendar_event_suggested": false,
  "todo_suggested": false
}

Rules:
- email_category: classify the email's nature for routing:
  - personal_important: requires personal action, is a direct personal communication, or has real urgency
  - general_news: informational content, newsletters, announcements, no action required
  - automated: system notifications, confirmations, receipts (only escalate if urgency is high/critical)
  - spam: unsolicited, no value
- sender_known = true if the From address matches a known contact below, or the email content
  itself makes clear this is someone already described in the known contacts or recent notes
  (e.g. a new address for a person already on file, or the body names them) - not just a
  plausible-sounding signature
- unknown_context = true only if sender_known is false AND the content suggests a real
  relationship worth remembering (not spam, not a one-off automated notice)
- critical = response or action needed within 24h
- invoice from a sender that is not sender_known always = unknown_context true
- if known contacts or recent notes already answer what question_for_user would ask, set
  question_for_user to null and unknown_context to false instead of asking again`;

export interface ClassificationContext {
  knownContacts: { identifier: string; name: string | null; relationship: string | null }[];
  notes: string[];
}

function contextBlock(context: ClassificationContext | undefined): string | null {
  if (!context) return null;
  const parts: string[] = [];
  if (context.knownContacts.length > 0) {
    parts.push(`Known contacts (sender directory, JSON): ${JSON.stringify(context.knownContacts)}`);
  }
  if (context.notes.length > 0) {
    parts.push(`Recent personal notes: ${JSON.stringify(context.notes)}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * `base` is the effective classification prompt for the run, which is the constant above unless
 * a `personal_classification` version is active in `prompt_versions` - see `active-prompts.ts`.
 * `context` (known contacts, recent personal/contact notes) is the same for every item in a run;
 * the per-account instructions and the context are prepended either way, so activating a version
 * never drops either.
 */
export function buildPersonalEmailPrompt(
  base: string,
  customInstructions: string | null,
  context?: ClassificationContext,
): string {
  const prefix = [contextBlock(context), customInstructions ? `Account context: ${customInstructions}` : null]
    .filter((part): part is string => part !== null);
  return prefix.length > 0 ? `${prefix.join("\n\n")}\n\n${base}` : base;
}
