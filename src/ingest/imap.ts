import type Imap from "imap";
import { and, eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { db, ingestDrops, rawItems, existingMessageIds, sourceQuality } from "../db";
import { classifyEmail, isBulkMail, senderAddress } from "./sources";
import { cleanEmailContent } from "./html";
import { openImap } from "./imap-client";
import { findUnsubscribeLink } from "./unsubscribe";
import type { NewsletterConfig } from "../config/newsletter-sources";
import type { EmailAccount } from "../config/email-accounts";

/** The four ways a fetched mail can be discarded before it becomes a `raw_items` row. */
type DropReason = "substack_system" | "ignored_sender" | "covered_by_rss" | "empty_content";

const PARSE_BATCH = 8;

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

/**
 * Phase 1 IMAP ingest for one account: fetches the last `IMAP_LOOKBACK_DAYS` (default 1) of mail into
 * `raw_items` (`message_id` dedupes) and logs discarded mails to `ingest_drops`. News accounts are
 * classified newsletter vs personal by ./sources.ts; the first mail of each newsletter source also
 * fills `source_quality.unsubscribe_url`. `checkedUnsubscribeSources` is shared across accounts and
 * mutated. Returns how many items were stored. Connection errors throw.
 */
export async function ingestImapAccount(account: EmailAccount, runDate: string, newsletterConfig: NewsletterConfig, rssSourceNames: Set<string>, checkedUnsubscribeSources: Set<string>): Promise<number> {
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
  const seen = new Set<string>();

  for (let start = 0; start < raw.length; start += PARSE_BATCH) {
    const batch = await Promise.all(raw.slice(start, start + PARSE_BATCH).map((buffer) => simpleParser(buffer)));
    const known = await existingMessageIds(batch.flatMap((p) => (p.messageId ? [p.messageId] : [])));
    const drops: (typeof ingestDrops.$inferInsert)[] = [];
    const items: (typeof rawItems.$inferInsert)[] = [];

    for (const parsed of batch) {
      const messageId = parsed.messageId ?? null;
      const from = parsed.from?.text ?? "";
      const subject = parsed.subject ?? "";

      const senderEmail = senderAddress(from);

      // Records why a mail was thrown away, so `/[date]/triage` can tell it from one that never arrived.
      const drop = (reason: DropReason, sourceType?: string, sourceName?: string | null) => {
        drops.push({
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
        drop("substack_system");
        continue;
      }

      if (account.ignore?.some((addr) => addr.toLowerCase() === senderEmail)) {
        drop("ignored_sender");
        continue;
      }

      // Not a drop: the message is already in `raw_items` under the run that first saw it, and
      // with a one-day lookback that is most of what a fetch returns.
      if (messageId && (known.has(messageId) || seen.has(messageId))) continue;

      const { sourceType, sourceName } = account.isNewsAccount
        ? classifyEmail(from, newsletterConfig, isBulkMail({
            listUnsubscribe: parsed.headers.get("list-unsubscribe"),
            listId: parsed.headers.get("list-id"),
            precedence: parsed.headers.get("precedence"),
          }))
        : { sourceType: "personal_email" as const, sourceName: senderEmail };

      // Skip newsletters covered by RSS - RSS content is cleaner and already ingested
      if (sourceType === "newsletter" && sourceName && rssSourceNames.has(sourceName)) {
        drop("covered_by_rss", sourceType, sourceName);
        continue;
      }

      // Looked up once per source, found or not, so a source that never mentions it isn't
      // AI-scanned on every message forever. Read by the "delete source" flow in `/sources`.
      if (sourceType === "newsletter" && sourceName && !checkedUnsubscribeSources.has(sourceName)) {
        checkedUnsubscribeSources.add(sourceName);
        const unsubscribeUrl = await findUnsubscribeLink(parsed);
        await db
          .insert(sourceQuality)
          .values({ sourceName, unsubscribeUrl, unsubscribeCheckedAt: new Date().toISOString() })
          .onConflictDoUpdate({
            target: sourceQuality.sourceName,
            set: { unsubscribeUrl, unsubscribeCheckedAt: new Date().toISOString() },
          });
      }

      const content = cleanEmailContent(
        parsed.html || undefined,
        parsed.text || undefined
      );

      if (!content) {
        drop("empty_content", sourceType, sourceName);
        continue;
      }

      if (messageId) seen.add(messageId);
      items.push({
        runDate,
        sourceType,
        sourceName: sourceName ?? (parsed.from?.value[0]?.name ?? from),
        accountId: account.user,
        messageId,
        rawContent: `Subject: ${subject}\nFrom: ${from}\n\n${content}`,
        receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
      });
    }

    dropped += drops.length;
    if (drops.length > 0) await db.insert(ingestDrops).values(drops);
    if (items.length > 0) {
      const inserted = await db.insert(rawItems).values(items).onConflictDoNothing({ target: rawItems.messageId }).returning({ id: rawItems.id });
      stored += inserted.length;
    }
  }

  console.log(
    `[Ingest/IMAP] [${account.user}] Stored ${stored} new items` +
    (dropped > 0 ? `, dropped ${dropped} before storage (see /${runDate}/triage)` : ""),
  );
  return stored;
}
