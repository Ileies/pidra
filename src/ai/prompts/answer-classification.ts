export const ANSWER_CLASSIFICATION_PROMPT = `The reader just answered a question about one email sender - who they are, or how they relate to the
reader. Read the answer and decide what, if anything, belongs in the sender directory as a standing
description of that person.

Return ONLY valid JSON:
{
  "relationship": "a short standing description of who the sender is and how they relate to the reader, or \\"\\" if the answer gives none",
  "spam_or_irrelevant": false
}

Rules:
- relationship: phrase it as a standing fact ("college friend, met at ETH", "recruiter, cold outreach"),
  not a transcript of the answer. Leave it "" when the answer is a dismissal, a guess, or gives no real
  relationship to record ("no idea", "never heard of them", "looks like spam, ignore it").
- spam_or_irrelevant = true when the answer says or implies the sender is spam, unwanted, a mistake, or
  otherwise not worth remembering as a contact. When true, relationship must be "".
- Never invent a relationship the answer does not support.`;
