import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/svelte";
import ExecutionsPage from "../src/routes/skills/executions/+page.svelte";
import QuestionsPage from "../src/routes/questions/+page.svelte";
import TopicsPage from "../src/routes/topics/+page.svelte";

/**
 * Asserts the designed bound of the lazy-reveal cap (20 rows, then "Show more" in batches of 20),
 * not just "some rows render" - a regression that dropped the cap (rendering every row at once)
 * would pass any test that only checks the list is non-empty. See `docs/todo/now.md`.
 */

function executions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    run_date: "2026-09-01",
    skill_name: "example_skill",
    parameters: null,
    status: "executed",
    result: null,
    triggered_by: "pipeline",
    created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
  }));
}

function questions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    kind: "item",
    question: `Who is example-sender-${i}@example.com?`,
    status: "open",
    statusDetail: null,
    mergedInto: null,
    answer: null,
    // Empty: the sources snippet renders its own nested <li> per source, which would otherwise
    // make querySelectorAll("li") count two elements per question instead of one.
    sources: [] as { extraction_id: string | null; from: string; subject: string | null; source_type: string; run_date: string }[],
    history: [],
    firstAsked: "2026-09-01",
    lastAsked: "2026-09-01",
    timesAsked: 1,
    blockingMinutesLeft: null,
    answeredAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  }));
}

function topics(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    headline: `Example standing story ${i}`,
    domain: "technology",
    runningSummary: null,
    firstSeen: "2026-09-01",
    lastUpdated: "2026-09-01",
    status: "active",
    updateCount: 1,
    sources: [] as string[],
    days: [] as string[],
  }));
}

describe("/topics lazy-reveal cap", () => {
  test("renders only the first 20 of 100 topics, with the remaining count in the button", () => {
    const { container, getByText } = render(TopicsPage, {
      props: { data: { topics: topics(100), mirrorEmpty: false } },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(getByText("Show more (80 more)")).toBeTruthy();
  });

  test("clicking Show more reveals the next 20 and updates the remaining count", async () => {
    const { container, getByText } = render(TopicsPage, {
      props: { data: { topics: topics(100), mirrorEmpty: false } },
    });

    getByText("Show more (80 more)").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelectorAll("li").length).toBe(40);
    expect(getByText("Show more (60 more)")).toBeTruthy();
  });

  test("hides the button once every topic is revealed", () => {
    const { container, queryByText } = render(TopicsPage, {
      props: { data: { topics: topics(20), mirrorEmpty: false } },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(queryByText(/Show more/)).toBeNull();
  });
});

describe("/questions lazy-reveal cap", () => {
  test("renders only the first 20 of 100 open questions, with the remaining count in the button", () => {
    const { container, getByText } = render(QuestionsPage, {
      props: { data: { open: questions(100) }, form: null },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(getByText("Show more (80 more)")).toBeTruthy();
  });

  test("clicking Show more reveals the next 20 and updates the remaining count", async () => {
    const { container, getByText } = render(QuestionsPage, {
      props: { data: { open: questions(100) }, form: null },
    });

    getByText("Show more (80 more)").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelectorAll("li").length).toBe(40);
    expect(getByText("Show more (60 more)")).toBeTruthy();
  });

  test("hides the button once every question is revealed", () => {
    const { container, queryByText } = render(QuestionsPage, {
      props: { data: { open: questions(20) }, form: null },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(queryByText(/Show more/)).toBeNull();
  });
});

describe("/skills/executions lazy-reveal cap", () => {
  test("renders only the first 20 of 100 rows, with the remaining count in the button", () => {
    const { container, getByText } = render(ExecutionsPage, {
      props: { data: { executions: executions(100) } },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(getByText("Show more (80 more)")).toBeTruthy();
  });

  test("clicking Show more reveals the next 20 and updates the remaining count", async () => {
    const { container, getByText } = render(ExecutionsPage, {
      props: { data: { executions: executions(100) } },
    });

    getByText("Show more (80 more)").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelectorAll("li").length).toBe(40);
    expect(getByText("Show more (60 more)")).toBeTruthy();
  });

  test("hides the button once every row is revealed", () => {
    const { container, queryByText } = render(ExecutionsPage, {
      props: { data: { executions: executions(20) } },
    });

    expect(container.querySelectorAll("li").length).toBe(20);
    expect(queryByText(/Show more/)).toBeNull();
  });
});
