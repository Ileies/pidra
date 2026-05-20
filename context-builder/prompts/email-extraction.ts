export const EMAIL_EXTRACTION_PROMPT = `Extract key information from this email. Return ONLY valid JSON matching this exact schema:
{
  "from_email": "string",
  "from_name": "string",
  "subject": "string",
  "date": "YYYY-MM-DD",
  "category": "work | personal | financial | service | automated | spam",
  "importance": "high | medium | low",
  "summary": "max 60 chars — what the email is about",
  "action_required": "string or null — what the user needs to do, if anything",
  "entities": ["names of people, orgs, projects mentioned"],
  "sentiment": "positive | neutral | negative"
}

Rules:
- summary: be specific, not generic ("Invoice #1234 from Acme" not "an invoice")
- action_required: null if no action needed
- entities: first names or org names only, max 5
- Return ONLY the JSON object, no prose`;
