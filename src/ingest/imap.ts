import Imap from "imap";
import { simpleParser } from "mailparser";
import { db, rawItems } from "../db";
import { eq } from "drizzle-orm";
import { classifyEmail, SELF_EMAILS } from "./sources";
import { cleanEmailContent } from "./html";

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

function getConfig(): ImapConfig {
  return {
    host: process.env.IMAP_HOST ?? "",
    port: parseInt(process.env.IMAP_PORT ?? "993"),
    user: process.env.IMAP_USER ?? "",
    password: process.env.IMAP_PASSWORD ?? "",
    tls: process.env.IMAP_TLS !== "false",
  };
}

function openImap(config: ImapConfig): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      connTimeout: 15000,
    });

    imap.once("ready", () => resolve(imap));
    imap.once("error", reject);
    imap.connect();
  });
}

function fetchMessagesSince(imap: Imap, since: Date): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", true, (err) => {
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

export async function ingestImap(runDate: string): Promise<number> {
  console.log("[Ingest/IMAP] Connecting...");
  const config = getConfig();

  if (!config.host || !config.user || !config.password) {
    console.warn("[Ingest/IMAP] IMAP credentials not configured, skipping");
    return 0;
  }

  const imap = await openImap(config);

  // Fetch emails from the configured lookback window (default 24h, 7 days on first run)
  const lookbackDays = parseInt(process.env.IMAP_LOOKBACK_DAYS ?? "1");
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  let raw: Buffer[];
  try {
    raw = await fetchMessagesSince(imap, since);
  } finally {
    imap.end();
  }

  console.log(`[Ingest/IMAP] Fetched ${raw.length} messages`);

  let stored = 0;
  for (const buffer of raw) {
    const parsed = await simpleParser(buffer);

    const messageId = parsed.messageId ?? null;
    const from = parsed.from?.text ?? "";
    const subject = parsed.subject ?? "";

    const senderEmail = ((from.match(/<([^>]+)>/) ?? [])[1] ?? from).toLowerCase();

    // Skip self-sent emails
    if (SELF_EMAILS.some((e) => senderEmail.includes(e.toLowerCase()))) continue;

    // Skip Substack system notifications (not actual newsletter content)
    if (senderEmail === "no-reply@substack.com" || senderEmail === "notifications@substack.com") continue;

    // Dedup by Message-ID
    if (messageId) {
      const existing = await db.select({ id: rawItems.id })
        .from(rawItems)
        .where(eq(rawItems.messageId, messageId))
        .limit(1);
      if (existing.length > 0) continue;
    }

    const { sourceType, sourceName } = classifyEmail(from);
    const content = cleanEmailContent(
      parsed.html || undefined,
      parsed.text || undefined
    );

    if (!content) continue;

    await db.insert(rawItems).values({
      runDate,
      sourceType,
      sourceName: sourceName ?? (parsed.from?.value[0]?.name ?? from),
      messageId,
      rawContent: `Subject: ${subject}\nFrom: ${from}\n\n${content}`,
      receivedAt: parsed.date?.toISOString() ?? new Date().toISOString(),
    });

    stored++;
  }

  console.log(`[Ingest/IMAP] Stored ${stored} new items`);
  return stored;
}
