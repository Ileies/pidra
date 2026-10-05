import type { DeskStory, NewsExtraction, NewsValidation } from "../../src/news/validate";
import type { NewsItem } from "../../src/news/format";

export const story = (overrides: Partial<DeskStory> = {}): DeskStory => ({
  headline: "Parliament approves the new budget after a late-night vote",
  summary: "The lower house passed the budget 312 to 290.",
  context: "",
  significance: 4,
  status: "new",
  confidence: "confirmed",
  region: "global",
  topic: "politics",
  happened_at: "2026-09-25T01:00:00Z",
  entities: ["Parliament"],
  sources: [{ publisher: "Example Wire", title: "Budget passes", url: "https://news.example.com/politics/budget-vote-passes" }],
  ...overrides,
});

export const clean: NewsValidation = { verified: true, unverifiedUrls: [], inWindow: true, duplicateOf: null, alreadyReported: null };

export const WINDOW = { start: "2026-09-24T04:30:00.000Z", end: "2026-09-25T04:30:00.000Z" };

export const item = (id: string, desk: NewsExtraction["desk"], overrides: Partial<NewsExtraction> = {}): NewsItem => ({
  id,
  story: {
    desk,
    headline: `Headline ${id}`,
    key_claim: `Summary ${id}.`,
    context: "",
    significance: 4,
    status: "new",
    confidence: "confirmed",
    region: "global",
    topic: "politics",
    happened_at: "2026-09-25",
    entities: [],
    sources: [{ publisher: `Pub ${id}`, title: "t", url: `https://${id}.example.com/story` }],
    validation: clean,
    ...overrides,
  },
});
