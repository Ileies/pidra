// Jev question rubrics (see JEV_INTEGRATION_PLAN.md). Each is a JSON document, not prose: the
// question and its ordered Score levels are parsed by src/ai/jev-rubrics.ts, which falls back to
// this baseline when an approved version does not parse. Public news only; never personal context.

export const JEV_NEWS_IMPACT_PROMPT = JSON.stringify({
  question: "How broadly would this public news event change the circumstances of people, institutions or markets?",
  criteria: [
    "Narrow: concerns one organization, person or small group and changes nothing for others",
    "Local or sectoral: changes circumstances for one city, region or industry segment",
    "National or industry-wide: changes circumstances across a country or a whole industry",
    "International or systemic: changes circumstances across several countries or a global system",
  ],
}, null, 2);
