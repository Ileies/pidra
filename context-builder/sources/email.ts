import Imap from "imap";
import { simpleParser } from "mailparser";
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

const SKIP_PATTERNS = [/no-?reply/i, /noreply/i, /mailer-daemon/i, /notifications?@/i, /do-?not-?reply/i, /bounce/i];

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

        fetch.on("message", (msg, uid) => {
          const chunks: Buffer[] = [];
          msg.on("body", (stream) => {
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
              const raw = Buffer.concat(chunks).toString();
              const fromMatch = raw.match(/^From:\s*(.+)$/im);
              const subjectMatch = raw.match(/^Subject:\s*(.+)$/im);
              const dateMatch = raw.match(/^Date:\s*(.+)$/im);
              const msgIdMatch = raw.match(/^Message-ID:\s*(.+)$/im);
              results.push({
                uid,
                messageId: msgIdMatch?.[1]?.trim() ?? `unknown-${uid}`,
                from: fromMatch?.[1]?.trim() ?? "",
                subject: subjectMatch?.[1]?.trim() ?? "",
                date: dateMatch ? new Date(dateMatch[1].trim()) : new Date(),
              });
            });
          });
        });

        fetch.once("error", reject);
        fetch.once("end", () => resolve(results));
      });
    });
  });
}

function fetchBody(imap: Imap, uid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], { bodies: "" });
    const chunks: Buffer[] = [];
    fetch.on("message", (msg) => {
      msg.on("body", (stream) => {
        stream.on("data", (c) => chunks.push(c));
      });
    });
    fetch.once("error", reject);
    fetch.once("end", async () => {
      try {
        const parsed = await simpleParser(Buffer.concat(chunks));
        const raw = parsed.text ?? parsed.html ?? "";
        resolve(cleanEmailContent(raw));
      } catch {
        resolve("");
      }
    });
  });
}

async function doFetch(account: EmailAccount, yearsBack: number, skipIds: Set<string>): Promise<EmailFetchResult> {
  if (account.isNewsAccount) return { items: [], skipped: 0 };

  const since = new Date();
  since.setFullYear(since.getFullYear() - yearsBack);

  const imap = await openImap(account);
  const results: EmailItem[] = [];
  let skipped = 0;

  try {
    const headers = await fetchHeadersSince(imap, since);

    for (const h of headers) {
      if (skipIds.has(h.messageId)) {
        skipped++;
        continue;
      }
      if (shouldSkip(h.from)) continue;

      try {
        const body = await fetchBody(imap, h.uid);
        if (!body.trim()) continue;

        const fromMatch = h.from.match(/^(?:"?(.+?)"?\s+)?<(.+?)>$/) ?? h.from.match(/(.+)/);
        const fromName = fromMatch?.[1]?.trim() ?? h.from;
        const fromEmail = fromMatch?.[2]?.trim() ?? h.from;

        results.push({
          messageId: h.messageId,
          from: fromEmail,
          fromName,
          subject: h.subject,
          date: h.date.toISOString(),
          body: body.slice(0, 50_000),
        });
      } catch (err) {
        await logError(`email:${account.user}`, err, h.messageId);
      }
    }
  } finally {
    imap.end();
  }

  return { items: results, skipped };
}

export async function fetchEmailItems(account: EmailAccount, yearsBack: number, skipIds: Set<string>): Promise<EmailFetchResult> {
  try {
    return await doFetch(account, yearsBack, skipIds);
  } catch (err) {
    process.stderr.write(`[email:${account.user}] IMAP error, reconnecting once...\n`);
    await Bun.sleep(3000);
    try {
      return await doFetch(account, yearsBack, skipIds);
    } catch (err2) {
      await logError(`email:${account.user}`, err2);
      return { items: [], skipped: 0 };
    }
  }
}
