import { db, rawItems, rawItemExists } from "../db";
import { utcDay } from "../util/time";

export interface SmsPayload {
  from?: string;
  body?: string;
  timestamp?: number;
}

export type SmsResult = "stored" | "duplicate" | "invalid";

/** Stores one forwarded SMS as a raw item; the Android forwarder retries, so a repeat is a no-op. */
export async function storeSms(payload: SmsPayload): Promise<SmsResult> {
  const from = payload.from?.trim();
  const text = payload.body?.trim();
  if (!from || !text) return "invalid";

  const tsMs = payload.timestamp ?? Date.now();
  const messageId = `sms:${from}:${tsMs}`;
  if (await rawItemExists(messageId)) return "duplicate";

  const receivedAt = new Date(tsMs).toISOString();
  await db.insert(rawItems).values({
    runDate: utcDay(new Date(tsMs)),
    sourceType: "sms",
    sourceName: from,
    messageId,
    rawContent: `From: ${from}\n\n${text}`,
    receivedAt,
  });
  return "stored";
}
