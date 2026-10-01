import { describe, expect, mock, test } from "bun:test";
import type Parser from "rss-parser";
import * as schema from "../src/db/schema";

// rss.ts writes through the db at module level; nothing here touches it.
mock.module("../src/db", () => ({ ...schema, db: {}, rawItemExists: async () => false }));
const { rssBody } = await import("../src/ingest/rss");

const feedItem = (fields: Record<string, string>) => fields as Parser.Item;

describe("the RSS body", () => {
  test("the full post in content:encoded wins over the teaser", () => {
    const body = rssBody(feedItem({
      contentSnippet: "Short teaser",
      "content:encoded": "<p>Nvidia approved a <b>$60bn</b> buyback.</p><p>It is the company&#8217;s largest.</p>",
    }));
    expect(body).toContain("Nvidia approved a $60bn buyback.");
    expect(body).toContain("company’s largest");
    expect(body).not.toContain("Short teaser");
  });

  test("a feed without the full post keeps its snippet", () => {
    expect(rssBody(feedItem({ contentSnippet: "Only a teaser", content: "<p>Only a teaser</p>" }))).toBe("Only a teaser");
  });

  test("a very long post is truncated, and says so", () => {
    const body = rssBody(feedItem({ "content:encoded": `<p>${"word ".repeat(10000)}</p>` }));
    expect(body.length).toBeLessThan(16100);
    expect(body.endsWith("[truncated]")).toBe(true);
  });
});
