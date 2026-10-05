type EmailCategory = "personal_important" | "general_news" | "automated" | "spam";

/**
 * What Phase 2 scores a classified mail at (0-5). Whether that is enough to reach synthesis is the
 * gate's question: `gate.ts` owns it, and its personal-mail branch must stay consistent with these
 * categories (score 0 for spam/general_news, urgency-based otherwise).
 */
export function emailEffectiveRelevance(category: EmailCategory | undefined, urgency: string | undefined): number {
  if (category === "spam" || category === "general_news") return 0;
  if (category === "automated") {
    return urgency === "critical" ? 5 : urgency === "high" ? 4 : 1;
  }
  return urgency === "critical" ? 5 : urgency === "high" ? 4 : 3;
}
