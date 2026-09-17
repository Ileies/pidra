import Imap from "imap";
import { and, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { db, ingestDrops, rawItems, rawItemExists } from "../db";
import { classifyEmail } from "./sources";
import { cleanEmailContent } from "./html";
import { RSS_SOURCE_NAMES } from "../config/rss-feeds";
import type { EmailAccount } from "../config/email-accounts";

/** The four ways a fetched mail can be discarded before it becomes a `raw_items` row. */
type DropReason = "substack_system" | "ignored_sender" | "covered_by_rss" | "empty_content";

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

  // This account's drops for this date are rewritten, not appended to: Phase 1 is wrapped in
  // `withRetry`, and three attempts must not read as three times the mail.
  await db.delete(ingestDrops).where(and(eq(ingestDrops.runDate, runDate), eq(ingestDrops.accountId, account.user)));

  let stored = 0;
  let dropped = 0;

  for (const buffer of raw) {
    const parsed = await simpleParser(buffer);

    const messageId = parsed.messageId ?? null;
    const from = parsed.from?.text ?? "";
    const subject = parsed.subject ?? "";

    const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase();

    /**
     * Records why a mail was thrown away, so `/[date]/triage` can show it. Without this, a mail
     * discarded here is indistinguishable from one that never arrived - which is the single
     * hardest case to diagnose, because the reader knows perfectly well that it was sent.
     */
    const drop = async (reason: DropReason, sourceType?: string, sourceName?: string | null) => {
      dropped++;
      await db.insert(ingestDrops).values({
        runDate,
        accountId: account.user,
        sourceType: sourceType ?? null,
        sourceName: sourceName ?? null,
        messageId,
        subject: subject || null,
        sender: from || null,
        receivedAt: parsed.date?.toISOString() ?? null,
        reason,
      });
    };

    // Skip Substack system notifications
    if (senderEmail === "no-reply@substack.com" || senderEmail === "notifications@substack.com") {
      await drop("substack_system");
      continue;
    }

    if (account.ignore?.some((addr) => addr.toLowerCase() === senderEmail)) {
      await drop("ignored_sender");
      continue;
    }

    // Not a drop: the message is already in `raw_items` under the run that first saw it, and
    // with a one-day lookback that is most of what a fetch returns.
    if (messageId && await rawItemExists(messageId)) continue;

    const { sourceType, sourceName } = account.isNewsAccount
      ? classifyEmail(from)
      : { sourceType: "personal_email" as const, sourceName: senderEmail };

    // Skip newsletters covered by RSS - RSS content is cleaner and already ingested
    if (sourceType === "newsletter" && sourceName && RSS_SOURCE_NAMES.has(sourceName)) {
      await drop("covered_by_rss", sourceType, sourceName);
      continue;
    }

    const content = cleanEmailContent(
      parsed.html || undefined,
      parsed.text || undefined
    );

    if (!content) {
      await drop("empty_content", sourceType, sourceName);
      continue;
    }

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

  console.log(
    `[Ingest/IMAP] [${account.user}] Stored ${stored} new items` +
    (dropped > 0 ? `, dropped ${dropped} before storage (see /${runDate}/triage)` : ""),
  );
  return stored;
}
