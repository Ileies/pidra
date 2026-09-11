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
});
