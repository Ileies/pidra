import Imap from "imap";
import { simpleParser } from "mailparser";
import { db, rawItems, rawItemExists } from "../db";
import { classifyEmail } from "./sources";
import { cleanEmailContent } from "./html";
import { RSS_SOURCE_NAMES } from "../config/rss-feeds";
import type { EmailAccount } from "../config/email-accounts";

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

function fetchMessagesSince(imap: Imap, folder: string, since: Date): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    imap.openBox(folder, true, (err) => {
      if (err) return reject(err);

      imap.search([["SINCE", since]], (err, uids) => {
        if (err) return reject(err);
        if (uids.length === 0) return resolve([]);

        const buffers: Buffer[] = [];
        const fetch = imap.fetch(uids, { bodies: "" });

        fetch.on("message", (msg) => {
          const chunks: Buffer[] = [];
          msg.on("body", (stream) => {
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("end", () => buffers.push(Buffer.concat(chunks)));
          });
        });

        fetch.once("error", reject);
        fetch.once("end", () => resolve(buffers));
      });
    });
  });
}

export async function ingestImapAccount(account: EmailAccount, runDate: string): Promise<number> {
  console.log(`[Ingest/IMAP] [${account.user}] Connecting to ${account.host}...`);

  const imap = await openImap(account);
  const lookbackDays = parseInt(process.env.IMAP_LOOKBACK_DAYS ?? "1");
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  let raw: Buffer[];
  try {
    raw = await fetchMessagesSince(imap, account.folder ?? "INBOX", since);
  } finally {
    imap.end();
  }

  console.log(`[Ingest/IMAP] [${account.user}] Fetched ${raw.length} messages`);

  let stored = 0;
  for (const buffer of raw) {
    const parsed = await simpleParser(buffer);

    const messageId = parsed.messageId ?? null;
    const from = parsed.from?.text ?? "";
    const subject = parsed.subject ?? "";

    const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase();

    // Skip Substack system notifications
    if (senderEmail === "no-reply@substack.com" || senderEmail === "notifications@substack.com") continue;

    if (account.ignore?.some((addr) => addr.toLowerCase() === senderEmail)) continue;

    if (messageId && await rawItemExists(messageId)) continue;

    const { sourceType, sourceName } = account.isNewsAccount
      ? classifyEmail(from)
      : { sourceType: "personal_email" as const, sourceName: senderEmail };

    // Skip newsletters covered by RSS - RSS content is cleaner and already ingested
    if (sourceType === "newsletter" && sourceName && RSS_SOURCE_NAMES.has(sourceName)) continue;

    const content = cleanEmailContent(
      parsed.html || undefined,
      parsed.text || undefined
    );

    if (!content) continue;

    await db.insert(rawItems).values({
      runDate,
      sourceType,
      sourceName: sourceName ?? (parsed.from?.value[0]?.name ?? from),
      accountId: account.user,
      messageId,
      rawContent: `Subject: ${subject}\nFrom: ${from}\n\n${content}`,
      receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
    });

    stored++;
  }

  console.log(`[Ingest/IMAP] [${account.user}] Stored ${stored} new items`);
  return stored;
}
