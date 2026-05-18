import Imap from "imap";
import { simpleParser } from "mailparser";
import { db, rawItems } from "../db";
import { eq } from "drizzle-orm";
import { classifyEmail } from "./sources";
import { cleanEmailContent } from "./html";
import type { EmailAccount } from "../config/email-accounts";

function openImap(account: EmailAccount): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: account.user,
      password: account.password,
      host: account.host,
      port: account.port,
      tls: account.tls,
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
  console.log(`[Ingest/IMAP] [${account.id}] Connecting to ${account.host}...`);

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

  console.log(`[Ingest/IMAP] [${account.id}] Fetched ${raw.length} messages`);

  const selfEmailsLower = account.selfEmails.map((e) => e.toLowerCase());

  let stored = 0;
  for (const buffer of raw) {
    const parsed = await simpleParser(buffer);

    const messageId = parsed.messageId ?? null;
    const from = parsed.from?.text ?? "";
    const subject = parsed.subject ?? "";

    const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase();

    // Skip self-sent emails for this account
    if (selfEmailsLower.some((e) => senderEmail.includes(e))) continue;

    // Skip Substack system notifications
    if (senderEmail === "no-reply@substack.com" || senderEmail === "notifications@substack.com") continue;

    // Dedup by Message-ID
    if (messageId) {
      const existing = await db.select({ id: rawItems.id })
        .from(rawItems)
        .where(eq(rawItems.messageId, messageId))
        .limit(1);
      if (existing.length > 0) continue;
    }

    const { sourceType, sourceName } = account.isNewsAccount
      ? classifyEmail(from)
      : { sourceType: "personal_email" as const, sourceName: senderEmail };

    const content = cleanEmailContent(
      parsed.html || undefined,
      parsed.text || undefined
    );

    if (!content) continue;

    await db.insert(rawItems).values({
      runDate,
      sourceType,
      sourceName: sourceName ?? (parsed.from?.value[0]?.name ?? from),
      accountId: account.id,
      messageId,
      rawContent: `Subject: ${subject}\nFrom: ${from}\n\n${content}`,
      receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
    });

    stored++;
  }

  console.log(`[Ingest/IMAP] [${account.id}] Stored ${stored} new items`);
  return stored;
}
