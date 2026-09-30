import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { acknowledgeNotification, reportNotificationKey } from "#lib/server/notifications.js";

export const POST: RequestHandler = async ({ params }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) error(400, "Invalid report date.");
  await acknowledgeNotification(reportNotificationKey(params.date));
  return new Response(null, { status: 204 });
};
