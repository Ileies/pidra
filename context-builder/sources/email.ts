// IMAP source: reads headers for the lookback window, then fetches bodies only for new, non-automated
// senders (read-only INBOX, via src/ingest/imap-client.ts). Called per account by phases/fetch.ts.
// `skipIds` are Message-IDs already indexed. Never throws: failures go to errors.json.
import type Imap from "imap";
import { simpleParser } from "mailparser";
import libmime from "libmime";
import type { EmailAccount } from "../config";
import { logError } from "../errors";
import { cleanEmailContent } from "../../src/ingest/html";
import { openImap } from "../../src/ingest/imap-client";

export interface EmailItem {
  messageId: string;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  body: string;
}

export interface EmailFetchResult {
  items: EmailItem[];
  skipped: number;
}

export interface EmailFetchProgress {
  onHeaderCount?: (count: number) => void;
  onItemDone?: () => void;
}

const SKIP_PATTERNS = [/no-?reply/i, /noreply/i, /mailer-daemon/i, /notifications?@/i, /do-?not-?reply/i, /bounce/i];

/** Decodes RFC 2047 encoded-words ("=?UTF-8?Q?...?="); names go straight into `contacts` and the briefing. */
function decodeHeader(value: string): string {
  if (!value.includes("=?")) return value;
  try {
    return libmime.decodeWords(value);
  } catch {
    return value;
  }
}

/**
 * Splits a From header into display name and address. Null address means the header carries none,
 * so the caller drops the item (the address becomes `contacts.identifier`, never a raw header).
 * Handles RFC 5322 comments such as `"Name" (via List) <list@example.com>`.
 */
function parseFromHeader(raw: string): { name: string; email: string | null } {
  const cleanName = (value: string): string =>
    value
      .replace(/\((?:[^()]*)\)/g, " ") // RFC 5322 comments
      .replace(/^[\s,;]+|[\s,;]+$/g, "")
      .replace(/^"(.*)"$/, "$1")
      .trim();

  const angle = raw.match(/<\s*([^<>\s]+@[^<>\s]+?)\s*>/);
  if (angle) {
    const name = cleanName(raw.slice(0, raw.indexOf(angle[0])));
    return { name: name || angle[1], email: angle[1] };
  }

  const bare = raw.match(/[^\s<>(),;:"]+@[^\s<>(),;:"]+/);
  if (bare) {
    const name = cleanName(raw.replace(bare[0], " "));
    return { name: name || bare[0], email: bare[0] };
  }

  return { name: cleanName(raw), email: null };
}

function shouldSkip(from: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(from));
}

function fetchHeadersSince(imap: Imap, since: Date): Promise<{ uid: number; messageId: string; from: string; subject: string; date: Date }[]> {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", true, (err) => {
      if (err) return reject(err);
      imap.search([["SINCE", since]], (err, uids) => {
        if (err) return reject(err);
        if (uids.length === 0) return resolve([]);

        const results: { uid: number; messageId: string; from: string; subject: string; date: Date }[] = [];
        const fetch = imap.fetch(uids, { bodies: "HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)", struct: false });

        fetch.on("message", (msg) => {
          const chunks: Buffer[] = [];
          // 'attributes' (real UID) and 'body' (header text) arrive in either order, and the
          // "message" event's 2nd param is a sequence number, not a UID. Wait for both, or
          // fetchBody() later fetches the wrong message.
          let uid: number | undefined;
          let raw: string | undefined;

          const tryPush = () => {
            if (uid === undefined || raw === undefined) return;
            // Unfold continuation lines first, or the line-anchored matches capture only the first fragment.
            const unfolded = raw.replace(/\r?\n[\t ]+/g, " ");
            const fromMatch = unfolded.match(/^From:\s*(.+)$/im);
            const subjectMatch = unfolded.match(/^Subject:\s*(.+)$/im);
            const dateMatch = unfolded.match(/^Date:\s*(.+)$/im);
            const msgIdMatch = unfolded.match(/^Message-ID:\s*(.+)$/im);
            results.push({
              uid,
              messageId: msgIdMatch?.[1]?.trim() ?? `unknown-${uid}`,
              from: decodeHeader(fromMatch?.[1]?.trim() ?? ""),
              subject: decodeHeader(subjectMatch?.[1]?.trim() ?? ""),
              date: dateMatch ? new Date(dateMatch[1].trim()) : new Date(),
            });
          };

          msg.once("attributes", (attrs: { uid: number }) => {
            uid = attrs.uid;
            tryPush();
          });
          msg.on("body", (stream) => {
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
              raw = Buffer.concat(chunks).toString();
              tryPush();
            });
          });
        });

        fetch.once("error", reject);
        fetch.once("end", () => resolve(results));
      });
    });
  });
}

const MAX_MESSAGE_BYTES = 20 * 1024 * 1024; // over this a message yields an empty body (skipped)

const FETCH_BODY_TIMEOUT_MS = 20_000;

/** Cleaned text of one message by UID; resolves "" (never rejects on body problems) when empty, oversized, unparsable or timed out. */
function fetchBody(imap: Imap, uid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], { bodies: "" });
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    let settled = false;
    // The fetch's own 'end' can race ahead of the body stream's 'end' on full bodies, so wait for
    // both or Buffer.concat reads an empty buffer. A deleted/expunged message never emits 'body',
    // hence the hard timeout below so one bad message cannot hang the run.
    let streamEnded = false;
    let fetchEnded = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("");
    }, FETCH_BODY_TIMEOUT_MS);

    const finish = async () => {
      if (settled) return;
      if (!streamEnded || !fetchEnded) return;
      settled = true;
      clearTimeout(timer);
      if (oversized) {
        resolve("");
        return;
      }
      try {
        const parsed = await simpleParser(Buffer.concat(chunks));
        resolve(cleanEmailContent(parsed.html || undefined, parsed.text));
      } catch {
        resolve("");
      }
    };

    fetch.on("message", (msg) => {
      msg.on("body", (stream) => {
        stream.on("data", (c) => {
          if (oversized) return;
          size += c.length;
          if (size > MAX_MESSAGE_BYTES) {
            oversized = true;
            chunks.length = 0;
            return;
          }
          chunks.push(c);
        });
        stream.once("end", () => {
          streamEnded = true;
          void finish();
        });
      });
    });
    fetch.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    fetch.once("end", () => {
      fetchEnded = true;
      void finish();
    });
  });
}

async function doFetch(account: EmailAccount, yearsBack: number, skipIds: Set<string>, progress?: EmailFetchProgress): Promise<EmailFetchResult> {
  if (account.isNewsAccount) return { items: [], skipped: 0 };

  const since = new Date();
  since.setFullYear(since.getFullYear() - yearsBack);

  const imap = await openImap(account);
  const results: EmailItem[] = [];
  let skipped = 0;

  try {
    const headers = await fetchHeadersSince(imap, since);
    progress?.onHeaderCount?.(headers.length);

    for (const h of headers) {
      if (skipIds.has(h.messageId)) {
        skipped++;
        progress?.onItemDone?.();
        continue;
      }
      if (shouldSkip(h.from)) {
        progress?.onItemDone?.();
        continue;
      }

      try {
        const body = await fetchBody(imap, h.uid);
        if (!body.trim()) {
          progress?.onItemDone?.();
          continue;
        }

        const { name: fromName, email: fromEmail } = parseFromHeader(h.from);
        if (!fromEmail) {
          progress?.onItemDone?.();
          continue;
        }

        results.push({
          messageId: h.messageId,
          from: fromEmail.toLowerCase(),
          fromName,
          subject: h.subject,
          date: h.date.toISOString(),
          body: body.slice(0, 50_000),
        });
      } catch (err) {
        await logError(`email:${account.user}`, err, h.messageId);
      }
      progress?.onItemDone?.();
    }
  } finally {
    imap.end();
  }

  return { items: results, skipped };
}

/** One account's new personal mail since now minus `yearsBack`; news accounts yield nothing. Retries once after a connection error, then returns empty. */
export async function fetchEmailItems(account: EmailAccount, yearsBack: number, skipIds: Set<string>, progress?: EmailFetchProgress): Promise<EmailFetchResult> {
  try {
    return await doFetch(account, yearsBack, skipIds, progress);
  } catch (err) {
    process.stderr.write(`[email:${account.user}] IMAP error, reconnecting once...\n`);
    await Bun.sleep(3000);
    try {
      return await doFetch(account, yearsBack, skipIds, progress);
    } catch (err2) {
      await logError(`email:${account.user}`, err2);
      return { items: [], skipped: 0 };
    }
  }
}
