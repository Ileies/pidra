import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, pushSubscriptions } from "./db";

/**
 * VAPID contact, handed to the push service so it can reach the operator about a misbehaving
 * sender. It is configuration, not a constant: it is a personal address, and the privacy rule in
 * CLAUDE.md keeps those out of the source. `mailto:` or an `https://` URL, both are valid.
 */
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:pidra@localhost";

/**
 * Push is optional. Without keys the pipeline still has to run to completion, so a missing pair
 * disables notifications with a warning instead of throwing at import time and taking down every
 * caller of this module - the bridge included.
 */
const PUSH_CONFIGURED = Boolean(process.env.PUBLIC_VAPID_KEY && process.env.VAPID_PRIVATE_KEY);

if (PUSH_CONFIGURED) {
  webpush.setVapidDetails(VAPID_SUBJECT, process.env.PUBLIC_VAPID_KEY!, process.env.VAPID_PRIVATE_KEY!);
} else {
  console.warn("[push] PUBLIC_VAPID_KEY / VAPID_PRIVATE_KEY unset - notifications are disabled.");
}

/** Delivers one payload to every subscription, dropping the ones the push service has retired. */
async function deliver(payload: string): Promise<void> {
  if (!PUSH_CONFIGURED) return;
  const subs = await db.select().from(pushSubscriptions);
  if (subs.length === 0) return;

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

/**
 * `failedSources` are the ingest sources that dropped out of an otherwise successful run, named as
 * `phase1` recorded them (`calendar`, `tasks`, `imap:<user>`).
 *
 * They belong on the success notification rather than on a second push. A run that loses Calendar
 * still writes a briefing, so `sendFailureNotification` never fires and the morning looks entirely
 * normal - which is how an expired Google token stayed invisible for four runs on 2026-09-12. The
 * degradation has to travel on the notification that does get sent, because it is the only one the
 * owner sees. Two pushes on one morning would be worse: the second is the one that gets swiped.
 */
export async function sendPushNotifications(
  date: string,
  summary: string | null,
  failedSources: string[] = [],
): Promise<void> {
  const body = summary?.slice(0, 120) ?? "Today's briefing is ready.";
  // Named rather than counted while the list is short: "calendar, tasks missing" is something the
  // owner can act on from the lock screen, where "2 sources missing" means opening the dashboard
  // to find out which. Past three it stops fitting, so it degrades to the count.
  const degraded =
    failedSources.length === 0
      ? null
      : failedSources.length <= 3
        ? `${failedSources.join(", ")} missing`
        : `${failedSources.length} sources missing`;

  // `date` is carried separately from `url` so the service worker can offer the "Personal
  // first" action and tag the notification per day, instead of stacking one per run (E5).
  await deliver(
    JSON.stringify({
      title: degraded ? `PIDRA - ${date} (${degraded})` : `PIDRA - ${date}`,
      body,
      url: `/${date}`,
      date,
    }),
  );
}

/**
 * The failure counterpart, and the reason it exists: the success notification is sent at the very
 * end of `runPipeline`, so every failure mode used to be silent. Waking up to no notification is
 * indistinguishable from waking up before the run finished, which is the worst of both - the run
 * that died at phase 6 on 2026-09-11 went unnoticed until the table was read by hand.
 *
 * This is not a violation of "never send emails for system events" (CLAUDE.md): it goes to the
 * dashboard's own PWA, not to an inbox, and it carries no detail beyond the failed step - the
 * error log lives on `/runs`, which is where the notification points.
 */
export async function sendFailureNotification(date: string, step: string): Promise<void> {
  await deliver(
    JSON.stringify({
      title: `PIDRA - ${date} failed`,
      body: `The pipeline stopped at ${step}. No briefing today; open /runs for the attempt log.`,
      url: "/runs",
    }),
  );
}
