import { describe, expect, test } from "bun:test";
import { parseJevRubric } from "../src/ai/jev-rubrics";
import { baseline } from "../src/ai/prompt-catalog";

describe("Jev rubrics", () => {
  test("the code baseline parses", () => {
    const rubric = parseJevRubric(baseline("jev_news_impact").text);
    expect(rubric?.criteria.length).toBeGreaterThanOrEqual(2);
  });

  test("rejects malformed rubrics", () => {
    expect(parseJevRubric("not json")).toBeNull();
    expect(parseJevRubric("[]")).toBeNull();
    expect(parseJevRubric(JSON.stringify({ question: "", criteria: ["a", "b"] }))).toBeNull();
    expect(parseJevRubric(JSON.stringify({ question: "q", criteria: ["only one"] }))).toBeNull();
    expect(parseJevRubric(JSON.stringify({ question: "q", criteria: ["a", ""] }))).toBeNull();
    expect(parseJevRubric(JSON.stringify({ question: "q", criteria: ["a", 2] }))).toBeNull();
  });

  test("trims whitespace", () => {
    expect(parseJevRubric(JSON.stringify({ question: " q ", criteria: [" a ", "b"] })))
      .toEqual({ question: "q", criteria: ["a", "b"] });
  });
});
