import { describe, expect, test } from "bun:test";
import {
  classifyFailure,
  failureLabel,
  ingestFailures,
  isMailbox,
  isNewsDesk,
  withoutDetail,
  type StepAttempt,
} from "../dashboard/src/lib/pipeline";

/**
 * The warning above each briefing is only worth having if it is right about *how* a source failed,
 * so these tests are mostly about that classification - and about the two rules that keep it from
 * leaking: only Phase 1 is read, and `withoutDetail` really does drop the text.
 */

const attempt = (error: string, step = "phase1", attemptNo = 1): StepAttempt => ({
  step,
  attempt: attemptNo,
  error,
  ts: "2026-09-18T04:30:00.000Z",
});

describe("classifyFailure", () => {
  test("a timeout during authentication is a timeout, not an auth failure", () => {
    // The real message from 2026-09-14. It matches both patterns, and calling it an auth failure
    // would send the reader to reset a password that was never wrong.
    expect(classifyFailure("Timed out while authenticating with server")).toBe("timeout");
  });

  test("a rejected login is an auth failure", () => {
    expect(classifyFailure("Authentication failed.")).toBe("auth");
    expect(classifyFailure("invalid_grant")).toBe("auth");
  });

  test("a refused socket is a connection failure", () => {
    expect(classifyFailure("connect ECONNREFUSED 10.0.0.1:993")).toBe("connection");
    expect(classifyFailure("getaddrinfo ENOTFOUND mail.example.com")).toBe("connection");
  });

  test("anything unrecognised is 'unknown' rather than a guess", () => {
    expect(classifyFailure("something nobody has seen before")).toBe("unknown");
  });
});

describe("ingestFailures", () => {
  test("splits the source off the message", () => {
    const [failure] = ingestFailures([attempt("imap:someone@example.com: Authentication failed.")]);
    expect(failure).toEqual({
      source: "imap:someone@example.com",
      kind: "auth",
      detail: "Authentication failed.",
    });
  });

  test("reads only phase 1 - a later step failed after the mail was already in hand", () => {
    // Phase 6 recorded a failing INSERT with its values inline on 2026-09-11. That is both the
    // wrong question for this warning and exactly the kind of message that quotes content.
    const attempts = [
      attempt(`Failed query: insert into "contacts" ("identifier") values ($1)`, "phase6"),
      attempt("calendar: invalid_grant"),
    ];
    expect(ingestFailures(attempts).map((f) => f.source)).toEqual(["calendar"]);
  });

  test("three retries of one dead mailbox are one warning", () => {
    const attempts = [1, 2, 3].map((n) =>
      attempt("imap:someone@example.com: Timed out while authenticating with server", "phase1", n),
    );
    expect(ingestFailures(attempts)).toHaveLength(1);
  });

  test("mailboxes sort ahead of the other sources", () => {
    const attempts = [
      attempt("calendar: invalid_grant"),
      attempt("tasks: invalid_grant"),
      attempt("imap:someone@example.com: Authentication failed."),
    ];
    expect(ingestFailures(attempts).map((f) => f.source)).toEqual([
      "imap:someone@example.com",
      "calendar",
      "tasks",
    ]);
  });

  test("a run that threw without naming a source still reports something", () => {
    const [failure] = ingestFailures([attempt("invalid_grant")]);
    expect(failure.source).toBe("ingest");
    expect(failure.kind).toBe("auth");
  });

  test("no attempts, no warning", () => {
    expect(ingestFailures([])).toEqual([]);
    expect(ingestFailures(null)).toEqual([]);
  });
});

describe("news desks", () => {
  test("a failed desk is a source that did not deliver, read from the news step", () => {
    const [failure] = ingestFailures([attempt("news:home: Request timed out.", "news")]);
    expect(failure).toEqual({ source: "news:home", kind: "timeout", detail: "Request timed out." });
    expect(isNewsDesk(failure)).toBe(true);
    expect(isMailbox(failure)).toBe(false);
    expect(failureLabel(failure)).toBe("the home news desk");
  });

  test("an unconfigured desk says so rather than calling itself failed", () => {
    const [failure] = ingestFailures([
      attempt("news:home: not configured: set NEWS_HOME_COUNTRY (and NEWS_HOME_CITY)", "news"),
    ]);
    expect(failure.kind).toBe("config");
  });

  test("every desk failing is one warning about the news as a whole", () => {
    const [failure] = ingestFailures([attempt("news: every news desk failed - world: 500", "news")]);
    expect(failure.source).toBe("news");
    expect(failureLabel(failure)).toBe("every news desk");
  });

  test("a news-shaped message on another step is still not read", () => {
    expect(ingestFailures([attempt("news:home: Request timed out.", "phase5-news")])).toEqual([]);
  });
});

describe("the offline boundary", () => {
  test("withoutDetail leaves nothing but the source and the kind", () => {
    const failures = ingestFailures([
      attempt("imap:someone@example.com: Timed out while authenticating with server"),
    ]);
    expect(failures[0].detail).toBeDefined();

    const stripped = withoutDetail(failures);
    expect(stripped).toEqual([{ source: "imap:someone@example.com", kind: "timeout" }]);
    expect(Object.hasOwn(stripped[0], "detail")).toBe(false);
  });
});

describe("labelling", () => {
  test("a mailbox is named by its account, everything else by itself", () => {
    const [mailbox] = ingestFailures([attempt("imap:someone@example.com: Authentication failed.")]);
    expect(isMailbox(mailbox)).toBe(true);
    expect(failureLabel(mailbox)).toBe("someone@example.com");

    const [calendar] = ingestFailures([attempt("calendar: invalid_grant")]);
    expect(isMailbox(calendar)).toBe(false);
    expect(failureLabel(calendar)).toBe("calendar");
  });
});
