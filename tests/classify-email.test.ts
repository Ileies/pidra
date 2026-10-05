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

// mailparser folds every List-* header into one `list` entry; reading "list-id" or "list-unsubscribe"
// directly is always undefined, which once left list mail undetected. Parsed for real, not hand-built.
describe("listHeaders on a parsed mail", () => {
  const parse = async (...headers: string[]) =>
    (await import("mailparser")).simpleParser(["Message-ID: <a@example.com>", "From: A <a@example.com>", "Subject: s", ...headers, "", "body"].join("\r\n"));

  test("List-Id and List-Unsubscribe are found, so the mail counts as bulk", async () => {
    const { listHeaders } = await import("../src/ingest/sources");
    for (const header of ["List-Id: <news.example.com>", "List-Unsubscribe: <mailto:u@example.com>"]) {
      const parsed = await parse(header);
      expect([header, isBulkMail(listHeaders(parsed.headers))]).toEqual([header, true]);
    }
  });

  test("a mail without list headers is not bulk and has no unsubscribe url", async () => {
    const { listHeaders } = await import("../src/ingest/sources");
    const found = listHeaders((await parse()).headers);
    expect(isBulkMail(found)).toBe(false);
    expect(found.unsubscribeUrl).toBeNull();
  });

  test("the unsubscribe url is the https one, never the mailto", async () => {
    const { listHeaders } = await import("../src/ingest/sources");
    expect(listHeaders((await parse("List-Unsubscribe: <mailto:u@example.com>, <https://example.com/u?t=1>")).headers).unsubscribeUrl).toBe("https://example.com/u?t=1");
    expect(listHeaders((await parse("List-Unsubscribe: <mailto:u@example.com>")).headers).unsubscribeUrl).toBeNull();
  });
});
