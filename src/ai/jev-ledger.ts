/**
 * Writes the Jev evaluation ledger (`jev_decisions`) from a `runJevDecision` result. Idempotent per
 * run, task, subject, model and rubric version: a retry replaces a failed row, never a successful one.
 * Stores a state hash and a subject key, not source text. A ledger failure never reaches the caller.
 */
import { sql } from "drizzle-orm";
import { db, jevDecisions } from "../db";
import { errMessage } from "../util/text";
import type { JevResult } from "./jev";
import type { Questions } from "@typesafe-ai/sdk";

export interface JevLedgerEntry {
  runId: string;
  /** `extractions.id` or the news story's stable key; stays the same across retries of one run. */
  subjectKey: string;
  /** The exact state text sent to Jev; only its hash is stored. */
  state: unknown;
  influencedReport?: boolean;
}

export function stateHash(state: unknown): string {
  const text = typeof state === "string" ? state : JSON.stringify(state);
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** Returns false for an `off` result (nothing recorded) and when the write failed. */
export async function recordJevDecision<Q extends Questions>(result: JevResult<Q>, entry: JevLedgerEntry): Promise<boolean> {
  if (result.status === "off") return false;
  const ok = result.status === "ok";
  const values = {
    runId: entry.runId,
    task: result.task,
    subjectKey: entry.subjectKey,
    model: result.model,
    rubricVersion: result.rubricVersion,
    mode: result.mode,
    status: ok ? "ok" : "error",
    stateHash: stateHash(entry.state),
    answers: ok ? (result.answers as Record<string, unknown>) : null,
    errorCode: ok ? null : result.code,
    errorMessage: ok ? null : result.message,
    tokensIn: ok ? result.tokensIn : null,
    tokensOut: ok ? result.tokensOut : null,
    latencyMs: result.latencyMs,
    influencedReport: entry.influencedReport ?? false,
  };
  try {
    await db.insert(jevDecisions).values(values).onConflictDoUpdate({
      target: [jevDecisions.runId, jevDecisions.task, jevDecisions.subjectKey, jevDecisions.model, jevDecisions.rubricVersion],
      set: values,
      setWhere: sql`${jevDecisions.status} <> 'ok'`,
    });
    return true;
  } catch (error) {
    console.warn(`jev ledger write failed: ${errMessage(error)}`);
    return false;
  }
}
