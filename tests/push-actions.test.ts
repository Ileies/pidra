// Protects pickBriefingActions (src/push.ts): which two buttons the briefing push carries.
import { expect, mock, test } from "bun:test";
import { dbModule } from "./fixtures/db";

mock.module("../src/db", () => dbModule({}));
const { pickBriefingActions } = await import("../src/push");

const base = { date: "2026-10-09", failedSources: 0, pendingActions: 0, openQuestions: 0 };

test("play is always first and points at the autoplay URL", () => {
  expect(pickBriefingActions(base)[0]).toEqual({ action: "play", title: "Play briefing", url: "/2026-10-09?play=1" });
});

test("second slot follows the priority: failures, actions, questions, news", () => {
  const second = (over: Partial<typeof base>) => pickBriefingActions({ ...base, ...over })[1];
  expect(second({ failedSources: 1, pendingActions: 3, openQuestions: 2 }).action).toBe("runs");
  expect(second({ pendingActions: 3, openQuestions: 2 })).toEqual({
    action: "review",
    title: "Review actions (3)",
    url: "/2026-10-09#personal",
  });
  expect(second({ openQuestions: 2 })).toEqual({ action: "questions", title: "Questions (2)", url: "/questions" });
  expect(second({}).action).toBe("news");
});

test("never more than two buttons", () => {
  expect(pickBriefingActions({ ...base, failedSources: 2, pendingActions: 1, openQuestions: 1 })).toHaveLength(2);
});
