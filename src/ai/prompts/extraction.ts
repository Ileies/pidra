export const NEWSLETTER_EXTRACTION_PROMPT = `You are a structured data extractor. Read the newsletter email below and return ONLY valid JSON. No preamble, no markdown, no explanation.

{
  "source": "newsletter name inferred from content",
  "date": "ISO date from email headers",
  "items": [
    {
      "headline": "one sentence, max 15 words",
      "topic_tags": ["tag1", "tag2"],
      "key_claim": "the specific claim or finding, 2 sentences max",
      "entities": ["named persons, orgs, technologies, places, laws"],
      "relevance_score": 3
    }
  ],
  "skip_reason": null
}

Rules:
- relevance_score 1–5: 5 = major breakthrough or directly actionable, 3 = interesting development, 1 = routine/low signal
- If the entire email is promotional, automated notification, or has no informational content, set items:[] and skip_reason:"promotional"
- Extract every distinct claim as a separate item, even if there are 10+
- topic_tags must be from: AI, China, Geopolitics, Finance, Science, BCI, Dev, Health, Startups, VC, EU, Switzerland, Energy, Philosophy, Security`;

export const ENTITY_EXTRACTION_PROMPT = `Extract named entities and relationships from the text below. Return ONLY valid JSON.

{
  "entities": [
    {
      "name": "canonical name",
      "aliases": [],
      "type": "person|org|tech|law|event|concept|place",
      "domain": "primary domain"
    }
  ],
  "relations": [
    {
      "from": "entity name",
      "to": "entity name",
      "type": "competes_with|heads|regulates|partners_with|acquired|enables|threatens|funds",
      "confidence": 0.85
    }
  ]
}

Only include relations with confidence >= 0.7. Only named entities - no generic terms.`;

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
- unknown_context = true if sender is unknown AND content suggests a relationship (not spam)
- critical = response or action needed within 24h
- invoice from unknown sender always = unknown_context true`;

/**
 * `base` is the effective classification prompt for the run, which is the constant above unless
 * a `personal_classification` version is active in `prompt_versions` - see `active-prompts.ts`.
 * The per-account instructions are prepended either way, so activating a version never drops
 * the account context.
 */
export function buildPersonalEmailPrompt(base: string, customInstructions: string | null): string {
  if (!customInstructions) return base;
  return `Account context: ${customInstructions}\n\n${base}`;
}
