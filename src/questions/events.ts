import { db, questionEvents } from "../db";

/** Only the method the outcome log needs, so it takes either `db` or a transaction inside it. */
export type DbLike = Pick<typeof db, "transaction">;

/**
 * Appends one row to the `question_events` outcome log. Never throws: a logging failure must not
 * lose the answer, merge or resolve it is explaining, only be missing from the log of it. The insert
 * runs in its own (nested) transaction, a savepoint when `exec` is already a transaction: a failed
 * statement otherwise aborts the whole outer transaction, so swallowing the error would not save the
 * plan, only turn the next statement's error into a confusing one. Always awaited, though -
 * a fire-and-forget insert would run concurrently with the next statement on the same connection.
 */
export async function logEvent(
  exec: DbLike,
  questionId: string,
  event: string,
  reason: string | null = null,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await exec.transaction((t) => t.insert(questionEvents).values({ questionId, event, reason, detail: detail ?? null }));
  } catch (err) {
    console.error(`[questions] Failed to log ${event} for ${questionId}:`, err);
  }
}
