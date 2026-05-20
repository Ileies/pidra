export const NOTE_EXTRACTION_PROMPT = `Extract key information from this Google Keep note. Return ONLY valid JSON:
{
  "title": "string",
  "category": "label from the note or inferred",
  "summary": "max 80 chars — what this note is about",
  "entities": ["people, orgs, projects, concepts mentioned"],
  "type": "rule | reminder | idea | list | reference | diary | other",
  "importance": "high | medium | low"
}

Rules:
- If the note is a rule/habit (e.g. "always do X"), type = rule and importance = high
- If it mentions people by name, include them in entities
- Return ONLY the JSON object, no prose`;
