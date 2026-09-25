/**
 * Shapes the pipeline writes that the dashboard reads back.
 *
 * `withRetry` records one of these per failed attempt into `pipeline_runs.step_errors`, which is
 * what makes a failure inspectable rather than just "failed". Mirrors `src/pipeline/withRetry.ts`.
 */
export interface StepAttempt {
  step: string;
  attempt: number;
  error: string;
  stack?: string;
  ts: string;
}

export type RunStatus = "running" | "completed" | "failed";

/**
 * How a source failed. A closed vocabulary on purpose, and the reason this is a classifier rather
 * than a pass-through: `step_errors` is raw text from whatever threw, and the plan keeps it off the
 * phone entirely because an attempt stack can quote raw source content - the
 * 2026-09-11 run recorded a failed `INSERT INTO contacts` with its values inline. Reducing a
 * message to one of these four words carries the fact the reader needs without carrying the text.
 */
export type IngestFailureKind = "timeout" | "auth" | "connection" | "config" | "unknown";

export interface IngestFailure {
  /**
   * `imap:<account>`, `calendar`, `tasks`, `rss`, or `ingest` when Phase 1 failed as a whole; for
   * the news desks `news:<desk>`, or `news` when every desk failed.
   */
  source: string;
  kind: IngestFailureKind;
  /**
   * The original message. **Server-side only** - the snapshot endpoint drops this field before
   * anything reaches the offline mirror, so a consumer that has it is one rendering on the server
   * from a live query.
   */
  detail?: string;
}

/** True for a source that is a mailbox, which is the half of this the reader acts on. */
export function isMailbox(failure: IngestFailure): boolean {
  return failure.source.startsWith("imap:");
}

/** True for a news desk, whose absence means world or local news is missing, not mail. */
export function isNewsDesk(failure: IngestFailure): boolean {
  return failure.source === "news" || failure.source.startsWith("news:");
}

/** The account part of `imap:<account>`, the desk for a news desk, or the source name unchanged. */
export function failureLabel(failure: IngestFailure): string {
  if (failure.source.startsWith("imap:")) return failure.source.slice("imap:".length);
  if (failure.source === "news") return "every news desk";
  if (failure.source.startsWith("news:")) return `the ${failure.source.slice("news:".length)} news desk`;
  return failure.source;
}

/**
 * Timeout is tested before auth, and the order is the whole point: "Timed out while authenticating"
 * matches both, and it is a timeout - the server never answered. Calling that an auth failure would
 * send the reader to reset a password that was never wrong. "Not configured" goes first of all: a
 * desk switched off by a missing setting has not failed, and saying so points at the fix.
 */
const KINDS: [RegExp, IngestFailureKind][] = [
  [/not configured/i, "config"],
  [/timed?\s?out|timeout|etimedout/i, "timeout"],
  [/invalid_grant|auth|credential|password|unauthoriz|login failed|invalid_client/i, "auth"],
  [/econnrefused|enotfound|ehostunreach|econnreset|epipe|socket|network|dns|certificate|tls/i, "connection"],
];

export function classifyFailure(message: string): IngestFailureKind {
  return KINDS.find(([pattern]) => pattern.test(message))?.[1] ?? "unknown";
}

/**
 * The sources that did not deliver on one run.
 *
 * Only `phase1` and `news` attempts are read: the two stages that fetch from outside. Everything
 * later in the chain failed *after* the material was in hand, so it is a different question with a
 * different page (`/runs`), and a Phase 2 or Phase 6 message is exactly the kind that quotes content.
 *
 * Deduplicated by source and kind, because `withRetry` records one attempt per try and three
 * identical timeouts are one dead mailbox, not three.
 */
export function ingestFailures(attempts: StepAttempt[] | null | undefined): IngestFailure[] {
  const seen = new Map<string, IngestFailure>();

  for (const attempt of attempts ?? []) {
    if ((attempt.step !== "phase1" && attempt.step !== "news") || !attempt.error) continue;

    // Both stages format a per-source failure as "<source>: <message>"; a run that threw outright
    // records the bare message, and that is still worth showing under a generic source.
    const split = attempt.step === "news"
      ? attempt.error.match(/^(news(?::[a-z]+)?):\s*(.+)$/is)
      : attempt.error.match(/^(imap:\S+?|calendar|tasks|rss):\s*(.+)$/is);
    const source = split ? split[1] : attempt.step === "news" ? "news" : "ingest";
    const detail = (split ? split[2] : attempt.error).trim();
    const kind = classifyFailure(detail);

    seen.set(`${source}|${kind}`, { source, kind, detail });
  }

  return [...seen.values()].sort((a, b) => {
    // Mailboxes first: they are what the reader asked to be warned about.
    if (isMailbox(a) !== isMailbox(b)) return isMailbox(a) ? -1 : 1;
    return a.source.localeCompare(b.source);
  });
}

/** Strips the raw message, leaving only what may cross into the offline mirror. */
export function withoutDetail(failures: IngestFailure[]): IngestFailure[] {
  return failures.map(({ source, kind }) => ({ source, kind }));
}
