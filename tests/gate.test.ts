import { describe, expect, test } from "bun:test";
import {
  corroborationBonus,
  decideGate,
  GATE_REASON_TEXT,
  NEWS_ABROAD_THRESHOLD,
  NEWS_THRESHOLD,
  NEWSLETTER_THRESHOLD,
  trustMultiplier,
  type GateInput,
  type GateReason,
} from "../src/pipeline/gate";

const input = (over: Partial<GateInput>): GateInput => ({
  sourceType: "newsletter",
  aiFailed: false,
  extractedJson: { headline: "Something happened" },
  relevanceScore: 3,
  trustScore: 1,
  sourceCount: 1,
  ...over,
});

const newsletter = (over: Partial<GateInput> = {}) => decideGate(input(over));
const mail = (extractedJson: Record<string, unknown> | null, over: Partial<GateInput> = {}) =>
  decideGate(input({ sourceType: "personal_email", extractedJson, relevanceScore: 4, ...over }));
const news = (validation: Record<string, unknown> | undefined, over: Partial<GateInput> = {}) =>
  decideGate(
    input({
      sourceType: "web_news",
      extractedJson: validation === undefined ? {} : { validation },
      ...over,
    }),
  );

describe("corroborationBonus", () => {
  test("grows with the number of distinct sources and caps at four", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(corroborationBonus)).toEqual([0, 0, 0.3, 0.7, 1, 1, 1]);
  });
});

describe("decideGate: shared behaviour", () => {
  test("a failed extraction wins over everything else", () => {
    for (const sourceType of ["newsletter", "personal_email", "sms", "web_news", "calendar"]) {
      const d = decideGate(input({ sourceType, aiFailed: true, relevanceScore: 5 }));
      expect(d.passed).toBe(false);
      expect(d.reason).toBe("extraction_failed");
    }
  });

  test("source types the gate does not cover are not_gated", () => {
    for (const sourceType of ["calendar", "todo", "unknown"]) {
      const d = decideGate(input({ sourceType, relevanceScore: 5 }));
      expect(d.passed).toBe(false);
      expect(d.reason).toBe("not_gated");
      expect(d.detail.threshold).toBeUndefined();
    }
  });

  test("records the arithmetic: score times trust plus corroboration", () => {
    const d = newsletter({ relevanceScore: 4, trustScore: 1.5, sourceCount: 3 });
    expect(d.effectiveRelevance).toBeCloseTo(4 * 1.5 + 0.7);
    expect(d.detail).toMatchObject({
      relevanceScore: 4,
      trustScore: 1.5,
      sourceCount: 3,
      corroborationBonus: 0.7,
      recordedBy: "phase3",
    });
    expect(d.detail.effectiveRelevance).toBe(d.effectiveRelevance);
  });

  test("a null score counts as zero but stays null on the record", () => {
    const d = newsletter({ relevanceScore: null, sourceCount: 2 });
    expect(d.effectiveRelevance).toBeCloseTo(0.3);
    expect(d.detail.relevanceScore).toBeNull();
  });

  test("null extractedJson is tolerated", () => {
    expect(() => decideGate(input({ extractedJson: null }))).not.toThrow();
    expect(mail(null).reason).toBe("passed");
  });

  test("recordedBy defaults to phase3 and passes backfill through", () => {
    expect(newsletter().detail.recordedBy).toBe("phase3");
    expect(newsletter({ recordedBy: "backfill" }).detail.recordedBy).toBe("backfill");
  });

  test("every reason has a plain-English line", () => {
    const reasons: GateReason[] = [
      "passed", "below_threshold", "skipped_by_extraction", "teaser_only", "extraction_failed",
      "spam", "general_news", "automated_low_urgency", "unverified_source", "outside_window",
      "duplicate", "already_reported", "not_gated",
    ];
    for (const r of reasons) expect(GATE_REASON_TEXT[r].length).toBeGreaterThan(0);
    expect(Object.keys(GATE_REASON_TEXT).sort()).toEqual([...reasons].sort());
  });
});

describe("decideGate: newsletters", () => {
  test("passes exactly at the threshold and fails just under it", () => {
    expect(NEWSLETTER_THRESHOLD).toBe(3);
    const at = newsletter({ relevanceScore: 3 });
    expect(at).toMatchObject({ passed: true, reason: "passed" });
    expect(at.detail.threshold).toBe(3);
    expect(newsletter({ relevanceScore: 2 })).toMatchObject({ passed: false, reason: "below_threshold" });
  });

  test("trust scales the score across the line in both directions", () => {
    expect(newsletter({ relevanceScore: 2, trustScore: 1.5 }).passed).toBe(true);
    expect(newsletter({ relevanceScore: 3, trustScore: 0.5 }).passed).toBe(false);
  });

  test("a distrusted source cannot sink an item rated 4 or higher", () => {
    expect(newsletter({ relevanceScore: 4, trustScore: 0.5 })).toMatchObject({ passed: true, effectiveRelevance: 4 });
    expect(newsletter({ relevanceScore: 3.9, trustScore: 0.5 }).passed).toBe(false);
    // Trust still lifts a strong item, it just never pulls one below its own score.
    expect(newsletter({ relevanceScore: 4, trustScore: 1.5 }).effectiveRelevance).toBe(6);
    expect(trustMultiplier(5, 0.6)).toBe(1);
    expect(trustMultiplier(2, 0.6)).toBe(0.6);
  });

  test("corroboration can lift a score of 2.7 over the line", () => {
    expect(newsletter({ relevanceScore: 2.7, sourceCount: 1 }).passed).toBe(false);
    expect(newsletter({ relevanceScore: 2.7, sourceCount: 2 }).passed).toBe(true);
  });

  test("an extraction that only carries skip_reason is skipped_by_extraction", () => {
    const d = newsletter({ extractedJson: { skip_reason: "promotional" }, relevanceScore: 5 });
    expect(d).toMatchObject({ passed: false, reason: "skipped_by_extraction" });
    expect(d.detail.threshold).toBe(NEWSLETTER_THRESHOLD);
  });

  test("a skip_reason next to a headline is not a skip, and an empty one never is", () => {
    expect(newsletter({ extractedJson: { skip_reason: "promo", headline: "Real item" } }).reason).toBe("passed");
    expect(newsletter({ extractedJson: { skip_reason: "" } }).reason).toBe("passed");
  });

  test("a teaser is rejected even when it scores well", () => {
    const d = newsletter({ extractedJson: { headline: "H", substance: "teaser" }, relevanceScore: 5 });
    expect(d).toMatchObject({ passed: false, reason: "teaser_only" });
    expect(newsletter({ extractedJson: { headline: "H", substance: "full" } }).passed).toBe(true);
  });

  test("skip outranks teaser", () => {
    const d = newsletter({ extractedJson: { skip_reason: "x", substance: "teaser" } });
    expect(d.reason).toBe("skipped_by_extraction");
  });
});

describe("decideGate: personal mail and sms", () => {
  test("spam and general_news are dropped whatever the score or urgency", () => {
    expect(mail({ email_category: "spam", urgency: "critical" }, { relevanceScore: 5 })).toMatchObject({
      passed: false,
      reason: "spam",
    });
    expect(mail({ email_category: "general_news" })).toMatchObject({ passed: false, reason: "general_news" });
  });

  test("automated passes only at critical or high urgency", () => {
    for (const urgency of ["critical", "high"]) {
      expect(mail({ email_category: "automated", urgency }).passed).toBe(true);
    }
    for (const urgency of ["medium", "low", undefined]) {
      const d = mail({ email_category: "automated", urgency });
      expect(d).toMatchObject({ passed: false, reason: "automated_low_urgency" });
    }
  });

  test("personal_important and unclassified mail pass on a positive score alone", () => {
    expect(mail({ email_category: "personal_important" }).passed).toBe(true);
    expect(mail({}).passed).toBe(true);
    expect(mail({}, { relevanceScore: 0 })).toMatchObject({ passed: false, reason: "below_threshold" });
    expect(mail({}, { relevanceScore: null }).passed).toBe(false);
  });

  test("a zero score can still pass on corroboration alone", () => {
    expect(mail({}, { relevanceScore: 0, sourceCount: 2 }).passed).toBe(true);
  });

  test("a failed personal-mail verdict carries a threshold of 0 and the classification", () => {
    const d = mail({ email_category: "personal_important", urgency: "low" }, { relevanceScore: 0 });
    expect(d.detail).toMatchObject({ threshold: 0, emailCategory: "personal_important", urgency: "low" });
  });

  test("sms follows the same rules as personal_email", () => {
    const sms = (json: Record<string, unknown>) =>
      decideGate(input({ sourceType: "sms", extractedJson: json, relevanceScore: 4 }));
    expect(sms({ email_category: "spam" }).reason).toBe("spam");
    expect(sms({}).passed).toBe(true);
  });

  test("non-string category and urgency are ignored", () => {
    const d = mail({ email_category: 7, urgency: null });
    expect(d.passed).toBe(true);
    expect(d.detail.emailCategory).toBeUndefined();
    expect(d.detail.urgency).toBeUndefined();
  });

  test("category and urgency are not recorded for newsletters without them", () => {
    const d = newsletter();
    expect("emailCategory" in d.detail).toBe(false);
    expect("urgency" in d.detail).toBe(false);
  });
});

describe("decideGate: news desks", () => {
  test("passes at the home bar and fails under it", () => {
    expect(NEWS_THRESHOLD).toBe(3);
    expect(news({ verified: true, inWindow: true }, { relevanceScore: 3 })).toMatchObject({
      passed: true,
      reason: "passed",
      detail: expect.objectContaining({ threshold: 3 }),
    });
    expect(news({ verified: true }, { relevanceScore: 2 })).toMatchObject({
      passed: false,
      reason: "below_threshold",
    });
  });

  test("a story about a country followed from abroad needs the higher bar", () => {
    expect(NEWS_ABROAD_THRESHOLD).toBe(4);
    const abroad = { verified: true, inWindow: true, abroad: true };
    expect(news(abroad, { relevanceScore: 3 })).toMatchObject({
      passed: false,
      reason: "below_threshold",
      detail: expect.objectContaining({ threshold: 4 }),
    });
    expect(news(abroad, { relevanceScore: 4 }).passed).toBe(true);
  });

  test("a row stored before validation existed is judged on its score", () => {
    expect(news(undefined, { relevanceScore: 3 }).passed).toBe(true);
    expect(news(undefined, { relevanceScore: 2 }).reason).toBe("below_threshold");
  });

  test("null verified and null inWindow do not fail a story, only an explicit false does", () => {
    expect(news({ verified: null, inWindow: null }).passed).toBe(true);
  });

  test("validation failures win over a top score", () => {
    const top = { relevanceScore: 5 };
    expect(news({ verified: false }, top).reason).toBe("unverified_source");
    expect(news({ inWindow: false }, top).reason).toBe("outside_window");
    expect(news({ duplicateOf: { desk: "world", headline: "H" } }, top).reason).toBe("duplicate");
    expect(news({ alreadyReported: { date: "2026-10-01", headline: "H" } }, top).reason).toBe(
      "already_reported",
    );
  });

  test("checks run in a fixed order when several fail", () => {
    const all = {
      verified: false,
      inWindow: false,
      duplicateOf: { desk: "world", headline: "H" },
      alreadyReported: { date: "2026-10-01", headline: "H" },
    };
    expect(news(all).reason).toBe("unverified_source");
    expect(news({ ...all, verified: true }).reason).toBe("outside_window");
    expect(news({ ...all, verified: true, inWindow: true }).reason).toBe("duplicate");
    expect(news({ ...all, verified: true, inWindow: true, duplicateOf: null }).reason).toBe("already_reported");
  });

  test("a failed check on an abroad story reports the abroad bar", () => {
    expect(news({ verified: false, abroad: true }).detail.threshold).toBe(4);
  });
});
