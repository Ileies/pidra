type EmailCategory = "personal_important" | "general_news" | "automated" | "spam";

/**
 * What Phase 2 scores a classified mail at. Whether that score is enough to reach synthesis is
 * the gate's question, not this one - `src/pipeline/gate.ts` owns it, with a named reason per
 * outcome. The two used to be a matched pair of functions here and drifting apart would have
 * meant an item filtered for a reason the log did not state.
 */
export function emailEffectiveRelevance(category: EmailCategory | undefined, urgency: string | undefined): number {
  if (category === "spam" || category === "general_news") return 0;
  if (category === "automated") {
    return urgency === "critical" ? 5 : urgency === "high" ? 4 : 1;
  }
  return urgency === "critical" ? 5 : urgency === "high" ? 4 : 3;
}
