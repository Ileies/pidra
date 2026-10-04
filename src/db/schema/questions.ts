import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, dateStr, jsonb, pk, timestamptz, updatedAt } from "./columns";

/** One mail behind a question: what the dashboard shows as "about" and what contact learning reads. */
export interface QuestionSource {
  extraction_id: string | null;
  from: string;
  subject: string | null;
  source_type: string;
  run_date: string;
}

/** A wording a question had before it was rephrased, and why it changed. */
export interface QuestionRevision {
  question: string;
  at: string;
  by: "model" | "user";
  reason: string | null;
}

/**
 * The standing question queue. A question stays open until answered, dismissed, or closed by the
 * reconcile call (`src/questions/reconcile.ts`); nothing is deleted and every earlier wording is on
 * `history`. Only `src/questions/store.ts` and `apply-plan.ts` write it.
 */
export const questions = pgTable("questions", {
  id: pk(),
  kind: text("kind").notNull(), // item | review | chat (asked by the assistant mid-conversation)
  question: text("question").notNull(),
  // open | answered | dismissed | resolved | merged
  status: text("status").notNull().default("open"),
  /** Why it was resolved or merged, in the reconcile call's words. */
  statusDetail: text("status_detail"),
  mergedInto: uuid("merged_into"),
  answer: text("answer"),
  sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`).$type<QuestionSource[]>(),
  history: jsonb("history").notNull().default(sql`'[]'::jsonb`).$type<QuestionRevision[]>(),
  firstAsked: dateStr("first_asked").notNull(),
  lastAsked: dateStr("last_asked").notNull(),
  /** How many runs raised it: a question asked every morning is worth answering first. */
  timesAsked: integer("times_asked").notNull().default(1),
  /** A review answer turned into insight notes (`absorbReviewAnswers`). */
  absorbedAt: timestamptz("absorbed_at"),
  answeredAt: timestamptz("answered_at"),
  /** What happened after the answer (`src/questions/process-answer.ts`); null = not applicable. */
  answerStatus: text("answer_status"), // running | done | failed
  /** The assistant's own account of what it changed, or the error. */
  answerOutcome: text("answer_outcome"),
  /** The chat conversation holding every skill call the answer triggered. */
  answerConversationId: uuid("answer_conversation_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Append-only outcome log for `questions`: one row per thing that happened to one, with its reason,
 * so reconcile's merge/resolve/drop calls can be judged later. Written in the same transaction as
 * the `questions` change it explains, by `src/questions/store.ts` and `apply-plan.ts` (via `events.ts`).
 */
export const questionEvents = pgTable("question_events", {
  id: pk(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  // asked | reasked | rewritten | answered | dismissed | reopened | merged | resolved | dropped
  event: text("event").notNull(),
  reason: text("reason"),
  /** Extra context an event needs, e.g. `{"merged_into": "<id>"}` on a merge. Never another table's data. */
  detail: jsonb("detail"),
  createdAt: createdAt(),
});
