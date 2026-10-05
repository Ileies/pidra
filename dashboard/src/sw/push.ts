/** The morning push and what a tap on it does. */

import { self } from "$app/service-worker";
import { workerSync } from "./sync.js";

const NOTIFICATION_ICON = "/icons/icon-192.png";

/**
 * The notification icon as a `data:` URL read from the precache. Given a path, the browser fetches
 * the icon from the origin before it shows anything, outside this worker and without its budgets,
 * so offline, with the icon not in the HTTP cache, a push showed nothing for over 40 s in
 * testing (2026-09-25) - the 06:30 briefing on a train, exactly. Without a cached copy the icon is
 * left out rather than risk that wait; the browser's default is shown instead.
 */
async function cachedIcon(): Promise<string | undefined> {
  try {
    const hit = await caches.match(NOTIFICATION_ICON);
    if (!hit) return undefined;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${hit.headers.get("content-type") ?? "image/png"};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  // The pull runs beside the notification, never before it: a push that shows nothing for long is
  // one iOS counts against the subscription. `waitUntil` keeps the worker alive for both.
  event.waitUntil(workerSync("always").catch(() => {}));
  event.waitUntil(
    cachedIcon().then((icon) =>
      self.registration.showNotification(data.title ?? "PIDRA", {
        body: data.body ?? "Today's briefing is ready.",
        icon,
        badge: icon,
        // Its own tag: a questions push shares its date with the briefing push, so without a
        // distinct tag one would replace the other instead of both surfacing.
        tag: data.kind === "questions" ? `questions-${data.date}` : data.date ? `report-${data.date}` : "pidra",
        data: { url: data.url ?? "/" },
        actions: data.date && data.kind !== "questions"
          ? [
              { action: "personal", title: "Personal first" },
              { action: "open", title: "Open report" },
            ]
          : [],
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = event.notification.data?.url ?? "/";
  // The Personal Action Center leads the report, so its anchor is where an action jumps to.
  const target = event.action === "personal" ? `${base}#personal` : base;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = self.location.origin + target;
      for (const client of list) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
