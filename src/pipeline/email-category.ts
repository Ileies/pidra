type EmailCategory = "personal_important" | "general_news" | "automated" | "spam";

export function emailEffectiveRelevance(category: EmailCategory | undefined, urgency: string | undefined): number {
  if (category === "spam" || category === "general_news") return 0;
  if (category === "automated") {
    return urgency === "critical" ? 5 : urgency === "high" ? 4 : 1;
  }
  return urgency === "critical" ? 5 : urgency === "high" ? 4 : 3;
}

export function isPersonalItemIncluded(extractedJson: Record<string, any> | null, effectiveRelevance: number): boolean {
  const category = extractedJson?.email_category as EmailCategory | undefined;
  if (category === "spam" || category === "general_news") return false;
  if (category === "automated") {
    const urgency = extractedJson?.urgency as string | undefined;
    return urgency === "critical" || urgency === "high";
  }
  return effectiveRelevance > 0;
}
