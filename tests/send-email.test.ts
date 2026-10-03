import { describe, expect, test } from "bun:test";
import type { EmailAccount } from "../src/config/email-accounts";
import { assertAllowedRecipients, findSenderAccount } from "../src/skills/mail-policy";

const account = {
  user: "sender@example.com",
  aliases: ["alias@example.com"],
} as EmailAccount;

describe("mail sender policy", () => {
  test("matches a configured account by user or alias", () => {
    expect(findSenderAccount([account], "sender@example.com")).toBe(account);
    expect(findSenderAccount([account], "alias@example.com")).toBe(account);
    expect(findSenderAccount([account], "other@example.com")).toBeUndefined();
  });

  test("rejects any system-account destination outside the allowlist", () => {
    const allowed = ["reader@example.com"];
    expect(() => assertAllowedRecipients(["reader@example.com"], allowed)).not.toThrow();
    expect(() => assertAllowedRecipients(["reader@example.com", "other@example.com"], allowed))
      .toThrow("Recipient not allowed: other@example.com");
    expect(() => assertAllowedRecipients(["reader@example.com"], []))
      .toThrow("Recipient not allowed: reader@example.com");
  });
});
