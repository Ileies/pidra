import { Hono } from "hono";
import { storeSms, type SmsPayload } from "../../ingest/sms";
import { bodyOf } from "../http";
import { smsSecretAuthorized } from "../sms-auth";

export const sms = new Hono();

// Receives messages from the Android SMS forwarder app: { from, body, timestamp? }.
// Auth: X-SMS-Secret must match SMS_WEBHOOK_SECRET; with the variable unset every request is rejected.
sms.post("/webhook/sms", async (c) => {
  if (!smsSecretAuthorized(process.env.SMS_WEBHOOK_SECRET, c.req.header("X-SMS-Secret"))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await storeSms(await bodyOf<SmsPayload>(c));
  if (result === "invalid") return c.json({ error: "Missing from or body" }, 400);
  return c.json(result === "duplicate" ? { ok: true, duplicate: true } : { ok: true });
});
