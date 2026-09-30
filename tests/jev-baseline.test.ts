import { describe, expect, test } from "bun:test";
import { candidateOutcome, sourceFailures } from "../src/evaluation/baseline";

describe("baseline candidate outcome", () => {
  test("keeps each exit distinct", () => {
    expect(candidateOutcome(null)).toBe("not_extracted");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: true, gatePassed: null, synthesisHandoff: null, includedInReport: false })).toBe("extraction_failed");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: false, gatePassed: false, synthesisHandoff: null, includedInReport: false })).toBe("gate_rejected");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: false, gatePassed: true, synthesisHandoff: "outside_synthesis_capacity", includedInReport: false })).toBe("outside_synthesis_capacity");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: false, gatePassed: true, synthesisHandoff: "sent", includedInReport: false })).toBe("sent_omitted");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: false, gatePassed: true, synthesisHandoff: "sent", includedInReport: true })).toBe("cited");
    expect(candidateOutcome({ sourceType: "newsletter", aiFailed: false, gatePassed: true, synthesisHandoff: null, includedInReport: false })).toBe("handoff_unrecorded");
  });

  test("a checked news story can be cited without the Section 1 handoff", () => {
    expect(candidateOutcome({ sourceType: "web_news", aiFailed: false, gatePassed: true, synthesisHandoff: null, includedInReport: true })).toBe("cited");
    expect(candidateOutcome({ sourceType: "web_news", aiFailed: false, gatePassed: true, synthesisHandoff: null, includedInReport: false })).toBe("sent_omitted");
  });
});

test("source failures remain separate from candidate decisions", () => {
  expect(sourceFailures([
    { step: "phase1", error: "imap:news: timeout" },
    { step: "news", error: "news:world: no results" },
    { step: "phase5-section1", error: "synthesis failed" },
  ])).toEqual([
    { step: "phase1", source: "imap:news", error: "timeout" },
    { step: "news", source: "news:world", error: "no results" },
  ]);
});
