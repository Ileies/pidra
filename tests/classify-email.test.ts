import { describe, expect, test } from "bun:test";
import { classifyEmail, isBulkMail } from "../src/ingest/sources";

const config = {
  domains: { "known-letter.com": "Known Letter" },
  addresses: { "digest@example.org": "Example Digest" },
};

describe("isBulkMail", () => {
  test("List-Unsubscribe or List-Id marks a mail as bulk", () => {
    expect(isBulkMail({ listUnsubscribe: "<mailto:u@example.com>" })).toBe(true);
    expect(isBulkMail({ listId: "<news.example.com>" })).toBe(true);
  });

  test("Precedence bulk or list marks a mail as bulk, case-insensitively", () => {
    expect(isBulkMail({ precedence: "bulk" })).toBe(true);
    expect(isBulkMail({ precedence: " List " })).toBe(true);
  });

  test("no list headers, or an unrelated Precedence, is not bulk", () => {
    expect(isBulkMail({})).toBe(false);
    expect(isBulkMail({ listUnsubscribe: false, listId: undefined, precedence: "first-class" })).toBe(false);
  });
});

describe("classifyEmail", () => {
  test("an unmatched sender without list headers stays personal", () => {
    expect(classifyEmail("Alex <alex@example.com>", config)).toEqual({
      sourceType: "personal_email",
      sourceName: "alex@example.com",
    });
  });

  test("an unmatched sender with list headers becomes a newsletter named after the display name", () => {
    expect(classifyEmail('"Example Letter" <hello@mail.example.com>', config, true)).toEqual({
      sourceType: "newsletter",
      sourceName: "Example Letter",
    });
  });

  test("without a display name the sender domain names the newsletter", () => {
    expect(classifyEmail("hello@mail.example.com", config, true)).toEqual({
      sourceType: "newsletter",
      sourceName: "mail.example.com",
    });
  });

  test("an explicit rule wins over the bulk fallback", () => {
    expect(classifyEmail("Someone <digest@example.org>", config, true).sourceName).toBe("Example Digest");
    expect(classifyEmail("Other <news@known-letter.com>", config, true).sourceName).toBe("Known Letter");
  });
});
