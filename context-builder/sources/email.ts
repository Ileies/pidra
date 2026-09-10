import Imap from "imap";
import { simpleParser } from "mailparser";
import libmime from "libmime";
import type { EmailAccount } from "../config";
import { logError } from "../errors";
import { cleanEmailContent } from "../../src/ingest/html";

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

/**
 * Decodes RFC 2047 encoded-words, so a sender arrives as "Michael Nüsken" rather than
 * "=?UTF-8?Q?Michael_N=C3=BCsken?=". These names are written straight into the `contacts`
 * table and shown in the briefing, so the raw form is not merely cosmetic.
 */
function decodeHeader(value: string): string {
  if (!value.includes("=?")) return value;
  try {
    return libmime.decodeWords(value);
  } catch {
    return value;
  }
}

/**
 * Splits a From header into display name and address. Returns a null address when the header
 * carries none, so the caller can drop the item rather than invent a contact.
 *
 * A plain `name <addr>` regex is not enough: real headers carry parenthesised comments
 * ("Paul Schuh" (via Some Mailing List) <list@example.com>), which made the previous pattern
 * fail over to a catch-all that wrote the entire header into the address field - and those
 * strings became `contacts.identifier` primary keys.
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

function openImap(account: EmailAccount): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: account.host,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      connTimeout: 15000,
    });
    imap.once("ready", () => resolve(imap));
    imap.once("error", reject);
    imap.connect();
  });
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
          // 'attributes' (carries the real UID) and 'body' (the header text) are emitted
          // independently per message and can arrive in either order - the 2nd "message"
          // event param is a SEQUENCE NUMBER, not a UID, so the real UID must come from
          // 'attributes'; wait for both before recording this message, or fetchBody()
          // later silently fetches the wrong (usually nonexistent) message by seqno.
          let uid: number | undefined;
          let raw: string | undefined;

          const tryPush = () => {
            if (uid === undefined || raw === undefined) return;
            // Unfold first: long From/Subject headers are wrapped onto continuation lines that
            // begin with whitespace, and a line-anchored match would capture only the first
            // fragment - which for an encoded-word header is not even separately decodable.
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

const MAX_MESSAGE_BYTES = 20 * 1024 * 1024; // safety cap - never buffer a pathological message whole

const FETCH_BODY_TIMEOUT_MS = 20_000;

function fetchBody(imap: Imap, uid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], { bodies: "" });
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    let settled = false;
    // The fetch command's own 'end' fires once the server closes the FETCH response, which can
    // race ahead of the message body stream's 'data'/'end' events (especially for full bodies,
    // vs. tiny header-only fetches where this never showed up) - wait for both before resolving,
    // or Buffer.concat(chunks) silently reads a still-empty buffer. If the server never emits a
    // 'body' event at all for a message (corrupted/deleted/expunged), streamEnded never fires -
    // guard with a hard timeout so one bad message can't hang the whole run forever.
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
        // No parseable address means nothing that can key a contact - skip rather than
        // fabricate an identifier out of the raw header.
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
