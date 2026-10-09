/** The morning push (payload `{title, body, url, date, kind}` from the server) and what a tap on it does. */

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
  const buttons: { action: string; title: string; url: string }[] = Array.isArray(data.actions)
    ? data.actions.filter((a: { action?: unknown; title?: unknown; url?: unknown }) =>
        typeof a?.action === "string" && typeof a.title === "string" && typeof a.url === "string" && a.url.startsWith("/"))
    : [];
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
        // The server picks the buttons and where each one leads (`pickBriefingActions`), so the
        // click handler only looks the tapped action up here.
        data: { url: data.url ?? "/", actions: buttons },
        actions: buttons.map(({ action, title }) => ({ action, title })),
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const button = (data.actions ?? []).find((a: { action: string }) => a.action === event.action);
  const target: string = button?.url ?? data.url ?? "/";
  // A play tap must reach the page as a navigation: a window already open on the report would
  // otherwise just be focused and never see `?play=1`.
  const fresh = target.includes("?play=");

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = self.location.origin + target;
      for (const client of list) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      const open = list.find((c) => "navigate" in c && "focus" in c);
      if (fresh && open) return (open as WindowClient).navigate(url).then((c) => c?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
