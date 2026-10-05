import webpush from "web-push";
import { inArray } from "drizzle-orm";
import { db, pushSubscriptions } from "./db";

/**
 * Web Push sender (reads `push_subscriptions`; the dashboard writes them). Callers: the pipeline end
 * (success/failure), the question flow. Payload shape is consumed by the dashboard service worker.
 */

/** VAPID contact: env config, not a constant, because it is a personal address (`mailto:` or https URL). */
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:pidra@localhost";

/** Push is optional: missing keys warn instead of throwing at import, so the pipeline and bridge still run. */
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

  const stale: string[] = [];
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    const err = r.reason as { statusCode?: number };
    if (err.statusCode === 410 || err.statusCode === 404) {
      stale.push(subs[i].endpoint);
      console.log(`[push] Removed stale subscription for ${subs[i].endpoint.slice(0, 60)}…`);
    } else {
      console.error(`[push] Failed to notify ${subs[i].endpoint.slice(0, 60)}…:`, err);
    }
  });
  if (stale.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, stale));

  const sent = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[push] Sent ${sent}/${subs.length} push notifications.`);
}

/**
 * The briefing-ready push. `failedSources` are ingest sources that dropped out of an otherwise
 * successful run, as `phase1` named them (`calendar`, `tasks`, `imap:<user>`). They ride on this
 * notification instead of a second push: a run that loses Calendar still succeeds, so the failure
 * push never fires and a degraded morning would look normal.
 */
export async function sendPushNotifications(
  date: string,
  summary: string | null,
  failedSources: string[] = [],
): Promise<void> {
  const body = summary?.slice(0, 120) ?? "Today's briefing is ready.";
  // Named up to three (actionable from the lock screen), then counted.
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
 * A deliberate second push on the same morning: new questions are new state on their own page, not a
 * degraded briefing. `kind: "questions"` gives it its own notification tag (`questions-<date>`) so it
 * neither replaces nor is replaced by the briefing push.
 */
export async function sendNewQuestionsNotification(date: string, count: number): Promise<void> {
  await deliver(
    JSON.stringify({
      kind: "questions",
      title: count === 1 ? "PIDRA - 1 new question" : `PIDRA - ${count} new questions`,
      body:
        count === 1
          ? "The morning's mail raised something worth asking about."
          : `The morning's mail raised ${count} things worth asking about.`,
      url: "/questions",
      date,
    }),
  );
}

/**
 * Failure push: the success push is sent at the very end of `runPipeline`, so without this a dead run
 * is indistinguishable from a run still in progress. Dashboard PWA only (docs/architecture-rules.md:
 * dashboard-only notifications); carries just the failed step, details are on `/runs`.
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
