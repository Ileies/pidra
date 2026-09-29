import { describe, expect, test } from "bun:test";
import { validateNewContacts } from "../src/pipeline/contact-suggestions";

describe("validateNewContacts", () => {
  test("skips an entry without the required sender identifier", () => {
    const result = validateNewContacts([
      { name: "Amazon Appstore Developer Account", priority: "high" },
    ]);

    expect(result).toEqual({ contacts: [], skipped: 1 });
  });

  test("keeps a valid contact while skipping invalid neighbours", () => {
    const result = validateNewContacts([
      { identifier: "developer@example.com", name: "Amazon", priority: "high" },
      { identifier: "", name: "No sender" },
    ]);

    expect(result).toEqual({
      contacts: [{ identifier: "developer@example.com", name: "Amazon", priority: "high" }],
      skipped: 1,
    });
  });

  test("rejects a non-email identifier such as a header parser's fallback text", () => {
    // Reproduces the 2026-09 bug: a mail with no `<address>` in its `From:` header made
    // `sourceName` fall back to raw text ("system"), which reached Section 2 as a pseudo-sender
    // and came back as a fabricated new_contacts entry with the reader's question answer as
    // "relationship".
    const result = validateNewContacts([
      { identifier: "system", name: "system", relationship: "I have no goal, I just want to learn." },
    ]);

    expect(result).toEqual({ contacts: [], skipped: 1 });
  });
});
