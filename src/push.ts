import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptions } from "./db";

webpush.setVapidDetails(
  "mailto:ileies200@gmail.com",
  process.env.PUBLIC_VAPID_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

export async function sendPushNotifications(date: string, summary: string | null): Promise<void> {
  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return;

  const payload = JSON.stringify({
    title: `PIDRA — ${date}`,
    body: summary?.slice(0, 120) ?? "Tagesreport bereit.",
    url: `/${date}`,
  });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      const err = r.reason as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subs[i].endpoint));
        console.log(`[push] Removed stale subscription for ${subs[i].endpoint.slice(0, 60)}…`);
      } else {
        console.error(`[push] Failed to notify ${subs[i].endpoint.slice(0, 60)}…:`, err);
      }
    }
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[push] Sent ${sent}/${subs.length} push notifications.`);
}
